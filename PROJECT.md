# 听写助手 — 工程契约

> 本文件是所有开发任务的唯一事实来源。任何子任务开始前必须完整阅读本文件。
> 不要修改本文件；如发现契约有问题，在任务报告里指出，由架构负责人（Opus）决定。

---

## 0. 项目定位

小学二年级语文听写工具。上传作业照片 → 识别出词语和拼音 → 家长选词 → 孩子听写。

**本期范围**：图片识别 + 听写流程。**不做批改、不做打分。**

运行形态：家庭局域网内的 Next.js 服务，手机/平板浏览器访问，可「添加到主屏幕」。

---

## 1. 技术栈（已定，不要更换）

| 层 | 选择 |
|---|---|
| 框架 | Next.js 15 App Router + React 19 + TypeScript（strict） |
| 样式 | Tailwind CSS（create-next-app 默认版本） |
| 数据库 | SQLite。优先 `better-sqlite3`；若在 Node 24 上安装失败，改用内置 `node:sqlite`，并在 `lib/db/driver.ts` 里隔离差异 |
| 注音 | `pinyin-pro`（纯 JS，无原生依赖） |
| 视觉识别 | 火山引擎方舟 Ark（doubao vision），provider 化 |
| 语音合成 | 火山引擎语音技术，provider 化 |
| 测试 | Vitest（单元测试） |

**本机环境**：Windows 11，Node v24.20.0，npm 11.19.0。命令用 PowerShell 语法。

**禁止**：引入 ORM、引入状态管理库、引入 UI 组件库、引入 Docker（本期本机跑）。

---

## 2. 目录结构

```
renee/
├── PROJECT.md                  # 本文件
├── .env.example                # 提交
├── .env.local                  # 不提交，放真实密钥
├── data/                       # 运行时数据，不提交
│   ├── app.db
│   ├── images/
│   └── audio/
├── fixtures/
│   └── worksheet-01.jpg        # 黄金样本（由 photo.jpg 移入）
├── scripts/
│   ├── tts-smoke.ts            # 多音字试音
│   └── vlm-smoke.ts            # 识别样张
├── lib/
│   ├── env.ts
│   ├── db/{driver.ts,schema.sql,index.ts,queries.ts}
│   ├── core/{normalize.ts,select.ts,order.ts,weight.ts,cachekey.ts}
│   ├── tts/{index.ts,volcano.ts,mock.ts,cache.ts}
│   ├── vlm/{index.ts,ark.ts,mock.ts}
│   └── pinyin.ts
├── app/
│   ├── layout.tsx, globals.css
│   ├── page.tsx                # 首页
│   ├── upload/page.tsx
│   ├── select/[worksheetId]/page.tsx
│   ├── dictation/[sessionId]/page.tsx
│   ├── done/[sessionId]/page.tsx
│   ├── history/page.tsx
│   └── api/**/route.ts
├── components/                 # 复用 UI
├── public/{manifest.json,icons/}
└── tests/                      # Vitest
```

---

## 3. 数据模型（SQLite，严格照此实现）

```sql
CREATE TABLE IF NOT EXISTS worksheet (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  title       TEXT,
  images      TEXT NOT NULL,          -- JSON 数组，data/images 下的相对路径
  raw_ocr     TEXT                    -- VLM 原始返回，便于复盘
);

CREATE TABLE IF NOT EXISTS word (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  pinyin      TEXT NOT NULL,          -- 带声调，空格分隔，如 "zhǎng dà"
  tts_text    TEXT,                   -- 读音修正用的替换文本，NULL 表示直接用 text
  is_single   INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL,
  UNIQUE(text, pinyin)
);

CREATE TABLE IF NOT EXISTS worksheet_word (
  worksheet_id INTEGER NOT NULL REFERENCES worksheet(id),
  word_id      INTEGER NOT NULL REFERENCES word(id),
  bucket       TEXT NOT NULL,         -- 'required' | 'optional'
  row_char     TEXT,                  -- 所属生字，required 的为 NULL
  row_pinyin   TEXT,                  -- 该生字的拼音（生字本身可能是多音字，必须持久化，不要现算）
  row_index    INTEGER,               -- 生字行序号，从 0 开始；required 的为 NULL
  ord          INTEGER NOT NULL,      -- 行内原始顺序 / required 内原始顺序
  PRIMARY KEY (worksheet_id, word_id)
);

CREATE TABLE IF NOT EXISTS session (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  worksheet_id INTEGER REFERENCES worksheet(id),
  created_at   TEXT NOT NULL,
  settings     TEXT NOT NULL,         -- JSON: {repeat,gapMs,speed,voice}
  cursor       INTEGER NOT NULL DEFAULT 0,
  finished_at  TEXT
);

CREATE TABLE IF NOT EXISTS attempt (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   INTEGER NOT NULL REFERENCES session(id),
  word_id      INTEGER NOT NULL REFERENCES word(id),
  seq          INTEGER NOT NULL,      -- 从 1 开始
  bucket       TEXT NOT NULL,
  status       TEXT NOT NULL,         -- 'pending' | 'written' | 'skipped'
  replay_count INTEGER NOT NULL DEFAULT 0,
  hint_level   INTEGER NOT NULL DEFAULT 0,   -- 0..3
  UNIQUE(session_id, seq)
);

CREATE TABLE IF NOT EXISTS mistake (
  word_id      INTEGER PRIMARY KEY REFERENCES word(id),
  skip_count   INTEGER NOT NULL DEFAULT 0,
  hint_sum     INTEGER NOT NULL DEFAULT 0,
  streak_ok    INTEGER NOT NULL DEFAULT 0,
  last_bad     TEXT,
  graduated    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attempt_session ON attempt(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_ww_sheet ON worksheet_word(worksheet_id, bucket);
```

**注意**：`word` 表以 `(text, pinyin)` 联合唯一。「长大 zhǎng dà」与「长短 cháng duǎn」中的「长」天然分家，音频缓存键因此自动正确。

---

## 4. 核心算法（纯函数，必须有单元测试）

### 4.1 `normalize(s: string): string`
去空格与标点 → 全角转半角 → 繁体转简体（用简单映射表即可，覆盖常见字；找不到映射就原样返回）。

### 4.2 `pickOptional(rows, required, stats): Word[]`
```
对 rows 按原始行序遍历（不打乱）：
  cands = row.words 中 normalize(text) 不在 required 集合里的
  若 cands 为空 → 跳过该行
  否则 push argmax(cands, w => weight(w, stats) + random()*0.5)
返回 picked   // 每行恰好 1 个，数量 = 有效行数
```

### 4.3 `buildOrder(required, optional): OrderedWord[]`
`[...required, ...optional]`。两组内部**保持输入原序，不打乱**。seq 从 1 开始连续编号。

### 4.4 `weight(word, stats): number`
```
1
+ 2.0 * min(skip_count, 3)
+ 1.0 * min(hint_sum, 4)
+ 1.5 * (last_bad 在 7 天内 ? 1 : 0)
- 3.0 * (graduated ? 1 : 0)
```
`stats` 为空时全部退化为 1，此时靠随机项区分。

### 4.5 `audioCacheKey(input): string`
`md5(ttsText + '|' + pinyin + '|' + voice + '|' + speed + '|' + repeat + '|' + gapMs + '|' + seqLabel)`
- `seqLabel` 是「第 N 个」的 N，或空串（试听时不报序号）
- 落盘为 `data/audio/<key>.mp3`

---

## 5. Provider 契约

### 5.1 VLM

```ts
export interface RecognizedWord { text: string; pinyin: string }
export interface RecognizedRow  { char: string; pinyin: string; words: RecognizedWord[] }
export interface RecognizeResult {
  title?: string;
  required: RecognizedWord[];
  rows: RecognizedRow[];
  warnings: string[];
}
export interface VlmProvider {
  recognize(images: Buffer[]): Promise<RecognizeResult>;
}
```

实现 `ark.ts`（火山方舟）与 `mock.ts`。`mock` 返回 §8 的黄金真值，让前端和 API 在没有密钥时也能完整跑通。

**提示词要求**：
- 明确告知「必听词语」是一张带标题的独立方框，框内所有词进 `required`
- 左侧表格逐行返回：该行生字 + 其拼音 + 同行所有组词
- **每个词都必须给带声调拼音**，多音字按本课语境定音
- 不确定的写进 `warnings`，不要猜
- 只输出 JSON，不要 markdown 代码围栏

**服务端后处理（必做）**：用 `pinyin-pro` 对每个词独立注音，与模型返回的拼音比对；不一致的词在 `warnings` 里追加一条 `拼音存疑: <词> 模型=<a> 本地=<b>`，并把该词标记为 `pinyinUncertain: true` 供前端标黄。**不要自动改写模型结果**，交给家长裁决。

### 5.2 TTS

```ts
export interface SynthInput {
  text: string;        // 实际送去合成的文本（已应用 tts_text 覆盖）
  pinyin: string;
  voice: string;
  speed: number;       // 0.8 | 1.0
  repeat: number;      // 3（听写）| 1（试听、再读一遍）
  gapMs: number;       // 1500
  seqLabel?: number;   // 有值则在最前面加「第 N 个。」
}
export interface TtsProvider {
  synthesize(input: SynthInput): Promise<Buffer>;   // mp3
  readonly name: string;
}
```

实现 `volcano.ts` 与 `mock.ts`（mock 生成一段静音 mp3 或复制固定样本，用于无密钥开发与自动化测试）。

**火山 HTTP 接口的已知形状**（以官方文档为准，所有字段走 env 可调）：

```
POST https://openspeech.bytedance.com/api/v1/tts
Headers:
  Authorization: Bearer;<VOLC_TTS_ACCESS_TOKEN>      ← 注意是分号不是空格
  Content-Type: application/json
Body:
{
  "app":   { "appid": "<VOLC_TTS_APP_ID>", "token": "<same access token>",
             "cluster": "<VOLC_TTS_CLUSTER>" },
  "user":  { "uid": "tingxie" },
  "audio": { "voice_type": "<VOLC_TTS_VOICE>", "encoding": "mp3",
             "speed_ratio": <speed> },
  "request": { "reqid": "<uuid>", "text": "<文本或 SSML>",
               "text_type": "plain" | "ssml", "operation": "query" }
}
Response: { "code": 3000, "data": "<base64 mp3>", "message": "..." }
```
`BASE_URL` 与上述所有字段名都要能从 env 覆盖，方便接口有出入时不改代码就能修。

### 5.3 多音字三层防线（重要，按顺序实现）

1. **SSML 注音**：`ssmlEnabled` 为真时，用 `<phoneme>` 标签按 `pinyin` 强制注音送 `text_type: "ssml"`。
2. **纯文本**：SSML 不被支持或返回错误时，自动回落到 `text_type: "plain"` 直接读词，并记一条日志。
3. **同音字替换兜底**：家长在选词页试听发现读错 → 点「读音不对」→ 前端弹出输入框，默认填入用 `pinyin-pro` 生成的同音替换建议（如「长大」→「涨大」）→ 家长确认后写入 `word.tts_text` → 以后这个词永远用替换文本合成。

第 3 条与 provider 无关，是 100% 有效的最终兜底，**必须实现**。

### 5.4 降级链

缓存命中 → 火山 TTS（重试 2 次，指数退避）→ 浏览器 `SpeechSynthesis`（前端兜底，界面标注「读音可能不准」）。任何一步失败都不得白屏或卡死。

---

## 6. 环境变量

```
PORT=3000
DATA_DIR=./data

VLM_PROVIDER=ark              # ark | mock
ARK_API_KEY=
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=                    # 方舟控制台里的推理接入点 ID 或模型名

TTS_PROVIDER=volcano          # volcano | mock
VOLC_TTS_BASE_URL=https://openspeech.bytedance.com/api/v1/tts
VOLC_TTS_APP_ID=
VOLC_TTS_ACCESS_TOKEN=
VOLC_TTS_CLUSTER=volcano_tts
VOLC_TTS_VOICE=
VOLC_TTS_SSML=1               # 1 尝试 SSML 注音，0 直接纯文本

TTS_REPEAT=3
TTS_GAP_MS=1500
TTS_SPEED=1.0
```

`lib/env.ts` 统一读取并校验；缺关键密钥时**自动降级到对应 mock provider 并在启动日志里明确打印**，绝不崩溃。

---

## 7. API 契约

| 方法 路径 | 入参 | 出参 |
|---|---|---|
| `POST /api/worksheet` | multipart，字段 `images`（可多张） | `{ worksheetId, title, required[], rows[], warnings[] }` |
| `PATCH /api/worksheet/:id` | `{ required[], rows[] }` 人工修正后的全量词表 | `{ ok: true }` |
| `POST /api/worksheet/:id/pick` | `{}` | `{ optional: Word[] }` 每行择一的结果 |
| `POST /api/session` | `{ worksheetId, wordIds: number[], settings }` | `{ sessionId, attempts: [{seq,wordId,bucket}] }` |
| `GET /api/audio` | query: `wordId, speed, repeat, seq?` | `audio/mpeg`，命中缓存直接读盘 |
| `PATCH /api/attempt/:id` | `{ status?, replayCount?, hintLevel? }` | `{ ok: true }` |
| `PATCH /api/word/:id/tts-text` | `{ ttsText }` | `{ ok: true }`（读音修正，同时清掉该词旧音频缓存） |
| `POST /api/session/:id/finish` | `{}` | `{ total, skipped, hintCount, skippedWords[] }` |
| `GET /api/session/:id` | — | 会话 + attempts + words，用于断点续做 |
| `GET /api/history` | — | 会话列表 |

错误一律返回 `{ error: { code, message } }` + 合适的 HTTP 状态码，`message` 是可直接展示给家长的中文。

---

## 8. 黄金真值（`fixtures/worksheet-01.jpg`，即项目根目录的 photo.jpg）

**课文**：植物妈妈有办法

**必听词语（14 个）**：
如果、已经、长大、告别、自己、出发、动物、胆子、肚子、那里、知识、更加、年轻、四海为家

**生字行（10 行，每行 3 个组词）**：

| # | 生字 | 拼音 | 组词 |
|---|---|---|---|
| 0 | 如 | rú | 如果、如同、比如 |
| 1 | 果 | guǒ | 水果、结果、果然 |
| 2 | 已 | yǐ | 已经、已往、早已 |
| 3 | 经 | jīng | 经过、经常、一本正经 |
| 4 | 别 | bié | 告别、别人、分别 |
| 5 | 轻 | qīng | 年轻、轻轻、轻快 |
| 6 | 发 | fā | 出发、发现、发生 |
| 7 | 胆 | dǎn | 胆子、大胆、胆小 |
| 8 | 肚 | dù | 肚皮、肚子、心知肚明 |
| 9 | 识 | shí | 识别、识字、常识 |

**推导出的验收断言**：
- 必听词恰好 14 个
- 生字行恰好 10 行，每行 3 个组词，共 30 个备选
- 剔重后每行剩余候选数依次为：2, 3, 2, 3, 2, 2, 2, 2, 2, 3
- 「帮我选」后选听词**恰好 10 个**，每行 1 个，与必听词零重复
- 听写总数 **24 个**，seq 1–14 全为 required，15–24 全为 optional

**必须读对的多音字**：
长大 `zhǎng dà`、一本正经 `yī běn zhèng jīng`、心知肚明 `xīn zhī dù míng`、识别 `shí bié`、常识 `cháng shí`、发现 `fā xiàn`、出发 `chū fā`

---

## 9. 界面硬指标（会被验收）

| 项 | 值 |
|---|---|
| 正文字号 | ≥ 20px |
| 听写页序号 | ≥ 72px |
| 可点区高度 | ≥ 88px |
| 一屏可点元素 | ≤ 3（听写页） |
| 对比度 | ≥ 4.5:1 |
| 「结束听写」 | 长按 1 秒才生效，短按无效 |
| 当前词 | **绝不上屏**，包括页面标题和 tab 标题 |

**听写页交互铁律**：
1. 切词时**先 stop 再 play**，绝不叠音
2. 「再读一遍」连点 5 次只触发一次，不排队
3. 进入第 i 词时预取第 i+1 词的音频
4. 首次进入必须由一次明确点击解锁音频（iOS Safari 要求），进入页面不自动播放第一个词
5. 切后台再回来停在原词，不自动播报
6. 三遍读完停在等待作答，不自动跳词
7. 「再读一遍」是慢速**单遍**，不是重播三遍，且 hint_level +1

---

## 10. 交付纪律

- TypeScript strict，不允许 `any` 逃逸到模块边界
- 每个任务结束前必须自己跑通 `npx tsc --noEmit` 和 `npm run build`
- 不要写 README、CHANGELOG、注释墙；代码自解释，注释只写「为什么」
- 不要擅自扩大范围。发现契约缺陷 → 在报告里指出，不要自作主张改设计
- **只修改任务里明确划给你的文件**，不要碰别人的文件
- 报告里必须写：做了什么、哪些没做、哪些地方你不确定、怎么验证

---

## 11. 架构决议记录

子代理提出的契约疑点由架构负责人在此裁决。**以本节为准，覆盖前文中相冲突的表述。**

| # | 议题 | 决议 |
|---|---|---|
| D-1 | `pinyin-pro` 的「一/不」变调 | **关闭 `toneSandhi`**。课本给生字标的是本调，`一本正经` 取 `yī běn zhèng jīng`。 |
| D-2 | 生字本身的拼音无处存放 | **已加 `worksheet_word.row_pinyin` 列**（见 §3）。生字可能是多音字，必须持久化 VLM 的判定，禁止用 `toPinyin(row_char)` 现算。 |
| D-3 | 答错时 `graduated` 是否重置 | **重置**。任何一次跳过或使用提示，同时把 `streak_ok` 和 `graduated` 都清 0。否则毕业过的词永远回不到池子里，与 §4.4 减 3 分的设计意图冲突。 |
| D-4 | `finishSession` 的 `hintCount` 含义 | 定义为**用过提示的词数**（`hint_level > 0` 的 attempt 条数），不是 hint_level 总和。前端文案相应写作「有 K 个词用过提示」。 |
| D-5 | `weight()` 以 wordId 为键 | 保持。`pickOptional` 只在词落库之后调用，id 必然存在；无 id 时退化为权重 1 是可接受的降级。 |
| D-6 | `.gitignore` 的 `.env*` 会忽略 `.env.example` | 已加 `!.env.example` 例外。 |
| D-18 | `finishSession` 必须幂等 | 现在每调用一次就重跑一遍 `applyAttemptToMistakes`，把 `skip_count`/`hint_sum` 反复累加——**这是数据污染，且会直接扭曲选词权重**。改法：`finished_at` 已有值时，只读出统计返回，不再重算 mistakes。前端刷新 `/done` 页、误触、重试都会触发这条路径，不能靠前端自律。 |
| D-19 | 补 `GET /api/worksheet/:id` | 选词页现在靠 `sessionStorage` 传数据，**家长一刷新就全没了**，只能退回重新上传。这是识别链路唯一的人工闸口，不能这么脆。补一个只读接口，返回与 `POST /api/worksheet` 相同的结构。 |
| D-20 | 重复词标记由服务端给出 | 前端为了把「已在必听里」的行内词置灰，自己近似重实现了一份 `normalize()`，与权威实现有分叉风险。改为服务端在 `rows[].words[]` 上直接给 `duplicateOfRequired: boolean`，用 `lib/core/normalize.ts` 的权威实现算。前端不做任何文本归一化。 |
| D-14 | schema 改为内联常量 | **删除 `lib/db/schema.sql`，改为 `lib/db/schema.ts` 导出的模板字符串常量。** `__dirname + schema.sql` 在 webpack 和 turbopack 下都会失效（打包后路径不存在），这是一个会阻断全部数据库路由的真 bug。`process.cwd()` 只是把问题推给部署环境；内联成常量则彻底不依赖文件系统，在 `output: 'standalone'` 的 Docker 镜像里也天然正确。 |
| D-15 | `worksheet_word` 主键 | **改为 `PRIMARY KEY (worksheet_id, word_id, bucket)`。** 作业纸上「如果」确实同时出现在必听框和「如」字行里，数据模型就该如实表达这件事。`saveWorksheetWords` 存**未过滤**的完整行（每行 3 个词），剔重交给 `pickOptional` 按文本做——它本来就是这么设计的。API 层现有的过滤绕行要删掉：它会导致前端拿到的 rows 和库里存的不一致，刷新后家长看到的东西会变。 |
| D-16 | `session.cursor` 的更新位置 | 不要给 `PATCH /api/attempt/:id` 加 `sessionId`/`seq` 参数。**`updateAttempt` 内部用一条 SQL 自己更新 cursor**：`UPDATE session SET cursor = MAX(cursor, (SELECT seq FROM attempt WHERE id=?)) WHERE id = (SELECT session_id FROM attempt WHERE id=?)`。逻辑属于数据层，不该外泄到 HTTP 契约。 |
| D-17 | `pick` 的返回字段 | 返回 `{ id, text, pinyin, rowIndex, char }`。前端要做「行内换词」，必须知道选中的词属于哪一行。 |
| D-10 | `putCache` 的 meta 参数 | **改为必填**：`putCache(key, audio, mime, meta: { ttsText, pinyin })`。可选参数一定会被忘记，而忘记的后果是读音修正后旧音频清不掉——让类型系统强制它。 |
| D-11 | 降级音频绝不进持久缓存 | `SynthOutput` 增加 `degraded?: boolean`。SSML 回落纯文本时置 `true`；`putCache` 遇到 `degraded` 直接拒绝写盘；`GET /api/audio` 对降级结果设响应头 `X-TTS-Degraded: 1`，前端据此显示「读音可能不准」。**理由**：降级音频一旦落盘就永久固化，一个读错的多音字会天天错下去，且无声无息，直接违背 G2。 |
| D-12 | SSML 回落的触发条件收窄 | 只在**业务错误**（HTTP 200 但 `code ≠ 3000`）时回落纯文本。网络/超时错误已经被 `postWithRetry` 重试过，再用纯文本重试一遍只是徒增延迟，还可能在网络恢复的瞬间悄悄返回一个未经注音的读音。网络类错误直接向上抛。 |
| D-13 | 轻声的假阳性必须消除 | `pinyin-pro` 对「胆子」给出 `dǎn zǐ` 而黄金真值是 `dǎn zi`，导致 14 个必听词里有 2 个被恒定误标存疑。**狼来了喊多了，家长就会无视黄色标记，整条防线作废。** 修法：比对时对轻声候选字（子头们么的了着过吧呢吗儿）按位只比无声调的基础音节。 |
| D-8 | TTS 返回类型 | 改为 `Promise<{ audio: Buffer; mime: string }>`，覆盖 §5.2 的 `Promise<Buffer>`。原因：mock provider 生成 WAV 比伪造合法 MP3 可靠得多，API 路由据 `mime` 设置 Content-Type。 |
| D-9 | mock TTS 的音频内容 | 不要静音。按 `repeat` 和 `gapMs` 生成 N 声短提示音（正弦波），使「三遍 + 1.5 秒间隔」的节奏在**没有任何云端密钥**的情况下就能真实听到并验证。 |
| D-7 | 「结果」的读音 | fixture 取通用读音 `jié guǒ`。本课语境下植物「结果」应为 `jiē guǒ`，但两种读音写出来是同样的字，不影响听写；真要改由家长在选词页用「读音不对」修正（§5.3 第 3 条）。 |

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

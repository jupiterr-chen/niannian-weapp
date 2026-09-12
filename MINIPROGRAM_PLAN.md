# 微信小程序改造方案

> 目标：把内网 Web 版听写工具上线为微信小程序，原内网 Web 版保留。
> 本文是改造阶段的流程契约，纪律沿用 PROJECT.md §10；实施中的裁决记入附录 B，不回改 PROJECT.md。

---

## 0. 一句话结论

**后端基本原样上云（Next.js API + 现成 Docker 镜像），前端从浏览器 Web 重写为微信小程序（Taro + React）。**
改造的主要工作量不在业务逻辑（`lib/core` 纯函数、VLM/TTS provider、API 契约、数据库全部复用），而在两处：

1. **合规前置**：账号、小程序备案、域名备案、HTTPS、隐私指引——关键路径，最先启动，等待期最长；
2. **听写页音频交互移植**：`HTMLAudioElement` → `InnerAudioContext`，§9 的交互铁律逐条落地。

一个必须先知道的事实：**个人主体小程序不支持 web-view 打开自有网页**，所以「把现有网站包一层」这条路不存在，前端必须重写。

---

## 1. 现状盘点

| 类别 | 内容 | 去向 |
|---|---|---|
| 直接复用 | `lib/core/*` 纯函数 + Vitest 测试 | 原样 |
| 直接复用 | `lib/vlm`、`lib/tts`（方舟 / 火山 / mock / 缓存 / WAV 装配） | 原样 |
| 直接复用 | `app/api/**` 路由与错误信封（PROJECT.md §7） | 路径不变，加鉴权中间件 |
| 直接复用 | 数据模型（§3） | 加 `user_id` 维度，见 §4.1 |
| 直接复用 | `Dockerfile` + `docker-compose.yml` | 原样部署到云服务器 |
| 重写 | `app/**` 全部页面、`components/*` | Taro 小程序（§5） |
| 作废 | PWA manifest / 添加到主屏幕 / `useWakeLock` / `SpeechSynthesis` 兜底 | 小程序有原生替代或删除 |
| 作废 | 内网信任模型（无鉴权、单家庭假设） | 改为 openid 多用户（§4.1） |

---

## 2. 目标架构

```
微信小程序（Taro + React）          浏览器 Web（现版，内网保留）
        │ HTTPS + token                  │ 内网 http，免鉴权
        └────────────┬───────────────────┘
                     ▼
        Next.js API（现有 /api/** 路由不变）
          ├─ /api/auth/login（新增，code2Session）
          ├─ SQLite（+user_id 维度）
          ├─ VLM 方舟 · TTS 火山 · 词级/成品音频缓存（全局共享）
          └─ 每用户限流与配额（新增）
        部署：腾讯云轻量服务器 + 已备案域名 + HTTPS 证书
```

两个前端共用一个后端；`AUTH_MODE=off|wechat` 区分：off 时所有请求映射到固定的 default user，内网 Web 行为完全不变。

---

## 3. 合规与账号前置（关键路径，最先启动）

| # | 事项 | 说明 | 耗时 | 费用 |
|---|---|---|---|---|
| 1 | 注册小程序账号（个人主体） | 名称全网唯一，先查重再注册（命名见附录 A） | 1 天 | 0（个人无需认证） |
| 2 | 小程序自身备案 | 2023-09 起小程序上架前必须完成，公众平台内一站式办理 | 1–2 周（并行） | 0 |
| 3 | 域名 + ICP 备案 | 服务器域名必须已备案。家庭宽带/NAS/内网穿透的域名无法备案，**后端必须迁到云服务器**（Docker 镜像原样部署） | 1–3 周（并行） | 域名 ~¥60/年 |
| 4 | HTTPS 证书 | 腾讯云免费 DV 证书或 Let's Encrypt | 1 天 | 0 |
| 5 | 服务器域名白名单 | request / uploadFile / downloadFile 三类都要配（downloadFile 供音频预取用） | 半天 | 0 |
| 6 | 用户隐私保护指引 | 声明「选中的照片或视频信息」（相册）与 openid；前端首次拉起相册前接隐私弹窗（`wx.requirePrivacyAuthorize`）；小程序内放一页隐私政策 | 1 天 | 0 |
| 7 | 服务类目 | 个人主体选「工具 > 效率」。本项目偏教育，存在被审回要求教育资质的概率，见 §8 风险表 | — | 0 |

**验收**：`curl https://<已备案域名>/api/history` 返回 JSON（此时可仍是 default user 数据）。

---

## 4. 后端改造清单

### 4.1 鉴权与多用户

- 新增 `user(id, openid UNIQUE, created_at)` 与 `token(user_id, token, created_at)` 表。
- `POST /api/auth/login {code}`：服务端拿 AppSecret 调 `code2Session` 换 openid，发随机 opaque token。
- 中间件解析 `Authorization: Bearer <token>`；401 时客户端用 `wx.login` 静默重登（无弹窗，体验无损）。
- 表结构变更：
  - `worksheet`、`session` 加 `user_id` 列；
  - `mistake` 主键从 `(word_id)` 改为 `(user_id, word_id)`——生词统计是每个孩子自己的；
  - `word` 表与音频缓存**保持全局共享**：不同用户听同一个 `(text, pinyin)` 命中同一份缓存与 TTS 记录，天然省钱，这是现有唯一键设计的红利。
- `GET /api/history` 及所有按 id 取数的路由校验归属（防横向越权，id 是自增整数，公网上必须挡）。

### 4.2 限流与配额（公网必备）

- 每用户每日上传次数上限（建议 20 次）与 TTS 合成上限（建议 1 万字/日），超限返回 §7 格式的中文错误。
- 图片张数与大小校验沿用现有逻辑。

### 4.3 上传通道适配

- 小程序侧：`wx.chooseMedia`（多选）→ `wx.compressImage`（quality ~80，单张 ≤1MB）→ `FileSystemManager.readFile` 读 base64 → `wx.request` 发 JSON。
- `/api/worksheet` 增加 `application/json { images: [dataUrl] }` 入参，与现有 multipart 并存，Web 版不动。
- 服务器保留上传照片的自动清理（建议 30 天，写进隐私政策；识别结果落库后照片即可删）。

### 4.4 音频格式（可选优化，不阻塞）

- `InnerAudioContext` 支持 wav，MVP 不动现有 PCM→WAV 装配（`lib/tts/wav.ts`）。
- 若公网流量在意，后续用 lamejs 把 PCM 封成 mp3，装配逻辑不动、只换容器，体积降一个量级。

### 4.5 运维

- 容器原样上云；`DEPLOY.md` 的 tar 更新流程改 git pull 或镜像仓库。
- 备份从手工 tar 改 cron 定期 `sqlite3 .backup` + 传对象存储（可选）。

---

## 5. 前端改造（Taro + React）

**选型**：Taro 4 + React + TypeScript。理由：现有页面全是 React hooks 状态机，Taro 保留 JSX 与 hooks，页面逻辑可大体平移；团队零新增语言成本。备选是原生 WXML（音频控制最直接但全部重写）；uni-app 是 Vue 系，放弃。

**样式**：Tailwind v4 在小程序需 weapp-tailwindcss 转译且对 v4 支持不成熟，改用 **SCSS + 设计令牌**。§9 与 D-27~D-29 的硬指标（字号下限、88px/48px 触达分级、2/3/4 列栅格、`clamp()` + 视口单位）原样翻译成 SCSS 变量与 mixin。

**目录**：新建 `miniprogram/`（或独立仓库），不与 Next.js 前端混放；后端留在本仓库，`app/**` 页面目录保留服务内网 Web 版。

### 5.1 页面映射

| Web | 小程序 | 备注 |
|---|---|---|
| `/`（首页）+ `/upload` | `pages/index` | 合并：进入即拍照/选图 |
| `/select/[worksheetId]` | `pages/select` | 参数改 query 传 id，不依赖 sessionStorage |
| `/dictation/[sessionId]` | `pages/dictation` | 最难一页，最后移植 |
| `/done/[sessionId]` | `pages/done` | |
| `/history` | `pages/history` | |
| — | `pages/privacy` | 隐私政策（提审需要） |

不用 tabBar：流程是线性的，历史入口放首页一角。

### 5.2 浏览器 API → 小程序 API 对照

| Web 现状 | 小程序替代 | 注意点 |
|---|---|---|
| `HTMLAudioElement` | `wx.createInnerAudioContext` + `wx.setInnerAudioOption({ obeyMuteSwitch: false })` | **obeyMuteSwitch 必须关**：iOS 拨了静音键也要出声，否则听写在教室外等于哑巴；先 `stop()` 再 `play()` 防叠音；`wx.onAudioInterruptionBegin/End` 处理来电中断 |
| 浏览器 HTTP 缓存预取 | `wx.downloadFile` → 本地临时路径再播 | 域名须在 downloadFile 白名单；失败降级直接给 `src` 播 URL |
| `fetch` | `Taro.request` 封装 | 统一注入 token；401 静默 `wx.login` 重登后重放一次 |
| `sessionStorage`（最近会话） | `wx.setStorageSync` | 键名沿用 `clientStorage.ts` 的约定 |
| `useWakeLock`（Screen Wake Lock） | `wx.setKeepScreenOn({ keepScreenOn: true })` | 比现在的轮询 hack 简单可靠，onHide 时记得关 |
| `SpeechSynthesis` 兜底 | 无对应物 | 降级链改为「缓存 → 火山 → 明确报错 + 重试按钮」，删掉「读音可能不准」的浏览器 TTS 分支 |
| `<input type="file">` 拍照/选图 | `wx.chooseMedia` + `wx.compressImage` | 首次调用前接隐私弹窗（§3-6） |
| 下拉刷新/页面滚动 | 听写页同样禁滚动 | 自定义导航或页面配置 `disableScroll`，防止孩子乱划 |

### 5.3 听写页交互铁律的移植落点（PROJECT.md §9 逐条）

1. 切词先 stop 再 play → `InnerAudioContext.stop()` 后重设 `src` 再 `play()`，token 计数器防旧实例回调（沿用 `playTokenRef` 思路）。
2. 「再读一遍」连点去抖 → 沿用 800ms 时间窗判断。
3. 预取第 i+1 词 → `wx.downloadFile` 到临时文件，进词时优先播本地路径。
4. 首次点击解锁音频 → **保留**。小程序虽无 iOS Safari 的硬限制，但真机首帧出声时机不稳，一次明确点击既是保险也是仪式感。
5. 切后台回前台停在原词不自动播 → 监听 `onHide` 暂停音频并记住状态，`onShow` 只恢复 UI 不出声。
6. 三遍读完停等待、不自动跳词 → 状态机原样平移。
7. 「再读一遍」慢速单遍 + hint_level+1 → 语义不变，`GET /api/audio` 的 repeat/speed 参数照用。
8. 当前词绝不上屏 → 页面标题用 `setNavigationBarTitle` 设固定文案；不用任何 toast/标题显示词。

「结束听写」沿用 D-23 的点击 + 二次确认面板（小程序没有浏览器长按菜单问题，但该交互已验证过防误触，直接照搬）。

---

## 6. 分阶段实施

| 阶段 | 内容 | 产出与验收 | 估时 |
|---|---|---|---|
| P0 合规启动 | §3 全部事项；服务器迁云（Docker 原样跑） | AppID、已备案域名、HTTPS 通 | 等待 1–3 周（并行） |
| P1 后端产品化 | 鉴权、多用户、限流、base64 上传、越权校验、照片清理 | Vitest 全绿；两个测试 openid 数据隔离；内网 Web 版回归无变化 | 2–3 天 |
| P2 小程序骨架 | Taro 初始化、请求/token 封装、隐私弹窗、错误信封对接 | 真机预览：登录 + 拉到空 history | 1 天 |
| P3 页面移植 | 按依赖序：privacy → history → done → index(上传) → select → **dictation（最后）**；每页对照 §9 硬指标自检 | 用 `fixtures/worksheet-01.jpg` 走通上传→选词→听写→完成→历史全流程，§8 黄金断言全过 | 4–6 天（听写页占 2–3） |
| P4 真机 QA | iPhone（静音键开/关、来电中断、锁屏恢复、低电量模式）、Android、弱网/飞行半程、iPad | 逐项打勾清单；重点验证 obeyMuteSwitch 与中断恢复 | 2–3 天 |
| P5 内测与提审 | 体验版二维码给家人用 3–7 天；准备类目/隐私/功能说明/测试账号；提审发布 | 线上可搜到、家人可用；内网 Web 版不受影响 | 审核 1–7 天 |

**总计**：净开发约 8–12 个工作日；备案等待期足以完成全部开发，日历时间主要被 P0 与审核占据。

---

## 7. 成本

| 项 | 费用 |
|---|---|
| 域名 | ~¥60/年 |
| 腾讯云轻量 2C2G | ~¥300–500/年 |
| 证书 / 备案 / 注册 | 0 |
| 方舟 VLM + 火山 TTS | 按量；家庭强度可忽略，公网放量由 §4.2 配额封顶 |
| **合计固定成本** | **≈ ¥400–600/年** |

---

## 8. 风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 类目被审回、要求教育资质 | 中 | 按「家庭听写辅助工具」措辞提交，避免「教学/课程」字样；被拒则调整描述，仍不行升级个体户主体 |
| 名称被占用 | 中 | 附录 A 备选依次尝试，注册前先在小程序后台查重 |
| iOS 音频策略（静音键/中断/锁屏） | 低 | obeyMuteSwitch=false + 中断事件监听，P4 真机清单强制覆盖 |
| SQLite 公网并发 | 低 | 确认 WAL 开启；家庭量级足够，放量再议 Postgres |
| 模型费用失控 | 低 | 每日配额 + 词级缓存全局共享 |
| 备案拖长 | 中 | P0 第一天启动；期间完成 P1–P3 全部开发 |

---

## 9. 不做的事

- 不做支付、打卡、社交、批改打分（PROJECT.md 本期范围继续有效）。
- 不做小程序端离线包（本地文件存储 10MB 上限，收益低，靠服务端缓存 + downloadFile 临时文件足够）。
- 不迁移内网时期的历史数据（生词统计重新积累；确有需要再写一次性脚本按 openid 导入，列为可选）。
- 不引入 ORM / 状态管理库 / UI 组件库（PROJECT.md §1 的禁令继续有效，Taro 自带的路由与状态够用）。

---

## 附录 A 命名建议

推荐 **「念念听写」**：念 = 念词给孩子听，品牌名「念念」即是读词的声音；谐音「念念不忘」，天然带 slogan——「念念听写，念念不忘」。备选依次：听写星球、田字格听写、听写精灵、嘀嗒听写。

注册前在小程序后台查重（名称全网唯一）；建议顺手查第 9 类（软件）与第 41 类（教育）商标。仓库名可用 `niannian-weapp`（小程序端）。

## 附录 B 契约裁决记录

实施过程中发现的契约问题与裁决记入此表（编号接续 PROJECT.md 的 D 系列），不回改 PROJECT.md。

| # | 议题 | 决议 |
|---|---|---|
| | | |

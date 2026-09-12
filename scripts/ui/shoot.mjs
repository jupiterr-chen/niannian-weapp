// 小程序 UI 截图工具：驱动微信开发者工具模拟器逐页截图，供视觉评审闭环使用。
// 用法：node scripts/ui/shoot.mjs [页面名…]（缺省截全部页面）
// 已开着的工具会通过 ws://127.0.0.1:9420 复用，避免每次冷启动。
import automator from "miniprogram-automator";
import fs from "node:fs";

const CLI = "D:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat";
const PROJECT = "D:/2.Develop/6.Claude/renee/miniprogram";
const OUT = "D:/2.Develop/6.Claude/renee/scripts/ui/shots";
// 服务器地址从环境变量 TX_BASE 传入（不要把内网地址写进本文件）：
//   TX_BASE=http://192.168.1.x:3000 node scripts/ui/shoot.mjs
// 需要先在开发者工具「设置-安全设置」里开启服务端口。
const BASE = process.env.TX_BASE || "http://127.0.0.1:3000";
const WS = "ws://127.0.0.1:9420";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const filter = process.argv.slice(2);
const want = (name) => filter.length === 0 || filter.includes(name);

// 用 NAS 上已有的 worksheet 8（真实识别数据）造一个 4 词小会话，
// 供听写页/完成页截图用；全部 written 收尾，不污染生词统计。
async function newSmallSession() {
  const ws = await (await fetch(`${BASE}/api/worksheet/8`)).json();
  const wordIds = ws.required.slice(0, 4).map((w) => w.id);
  const res = await fetch(`${BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worksheetId: 8, wordIds }),
  });
  const body = await res.json();
  if (!body.sessionId) throw new Error("create session failed: " + JSON.stringify(body));
  return body.sessionId;
}

async function finishSmallSession(sessionId) {
  const full = await (await fetch(`${BASE}/api/session/${sessionId}`)).json();
  for (const a of full.attempts) {
    await fetch(`${BASE}/api/attempt/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "written" }),
    });
  }
  await fetch(`${BASE}/api/session/${sessionId}/finish`, { method: "POST" });
}

async function connect() {
  try {
    const mp = await automator.connect({ wsEndpoint: WS });
    console.log("connected to running devtools");
    return mp;
  } catch (e) {
    console.log("launching devtools…");
    return automator.launch({ cliPath: CLI, projectPath: PROJECT });
  }
}

async function shot(mp, url, name, wait = 1500) {
  if (!want(name)) return;
  await mp.reLaunch(url);
  await sleep(wait);
  await mp.screenshot({ path: `${OUT}/${name}.png` });
  console.log("✓", name);
}

const mp = await connect();
await sleep(1500);
fs.mkdirSync(OUT, { recursive: true });

try {
  await shot(mp, "/pages/index/index", "index");
  await shot(mp, "/pages/upload/upload", "upload");
  await shot(mp, "/pages/select/select?id=8", "select", 1800);

  if (want("dictation") || want("dictation-unlock") || want("done")) {
    const sid = await newSmallSession();

    await shot(mp, `/pages/dictation/dictation?id=${sid}`, "dictation-unlock");
    if (want("dictation")) {
      const page = await mp.currentPage();
      await page.callMethod("handleUnlock");
      await sleep(2500);
      await mp.screenshot({ path: `${OUT}/dictation.png` });
      console.log("✓ dictation");
    }

    await finishSmallSession(sid);
    await shot(mp, `/pages/done/done?id=${sid}`, "done", 1800);
  }

  await shot(mp, "/pages/history/history", "history", 1800);
  await shot(mp, "/pages/privacy/privacy", "privacy", 800);
} finally {
  await mp.disconnect();
}
console.log("done");

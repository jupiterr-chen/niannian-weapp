// 端到端 API 冒烟测试。用法：npx tsx scripts/api-smoke.ts
// 前提：npm run dev 已经在另一个终端跑起来（默认 http://localhost:3000，
// 可用 API_BASE_URL 环境变量覆盖）。脚本用真实 fetch() 打 HTTP，按
// PROJECT.md §7 的接口顺序跑一遍完整流程，并对照 §8 的黄金真值断言。
//
// 只读地借用 lib/core/cachekey.ts 和 lib/tts/cache.ts 来验证第 7 步的缓存
// 失效行为（见该步注释）——这是脚本自身的验证手段，不修改任何 lib 文件。
import fs from "node:fs";
import path from "node:path";
import { audioCacheKey } from "../lib/core/cachekey";
import { getCached } from "../lib/tts/cache";

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3000";

// 和 GET /api/audio 请求里显式传的参数保持一致，这样脚本自己算出的缓存键
// 才会和路由内部算出来的一致。
const AUDIO_VOICE = "smoke-voice";
const AUDIO_SPEED = 1;
const AUDIO_REPEAT = 3;
const AUDIO_GAP_MS = 1500;
const AUDIO_SEQ = 1;

// §8 黄金真值：14 个必听词里，恰好这 7 个同时出现在某一行的组词候选里
// （如果@如行、已经@已行、告别@别行、年轻@轻行、出发@发行、胆子@胆行、
// 肚子@肚行）。D-20 的 duplicateOfRequired 标记必须精确对上这个集合。
const GOLDEN_DUPLICATE_TEXTS = ["如果", "已经", "告别", "年轻", "出发", "胆子", "肚子"];

interface RequiredWordOut {
  id: number;
  text: string;
  pinyin: string;
  pinyinUncertain?: boolean;
}
interface RowWordOut extends RequiredWordOut {
  duplicateOfRequired: boolean;
}
interface RowOut {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: RowWordOut[];
}
interface WorksheetResp {
  worksheetId: number;
  title: string | null;
  required: RequiredWordOut[];
  rows: RowOut[];
  warnings: string[];
}
interface PickWordOut {
  id: number;
  text: string;
  pinyin: string;
  rowIndex: number;
  char: string;
}
interface PickResp {
  optional: PickWordOut[];
}
interface SessionAttemptOut {
  seq: number;
  wordId: number;
  bucket: "required" | "optional";
}
interface SessionPostResp {
  sessionId: number;
  attempts: SessionAttemptOut[];
}
interface SessionFullResp {
  session: { cursor: number };
  attempts: { id: number; seq: number }[];
}
interface FinishResp {
  total: number;
  skipped: number;
  hintCount: number;
  skippedWords: unknown[];
}

class StepFailure extends Error {
  constructor(
    public step: number,
    message: string
  ) {
    super(message);
  }
}

function assert(cond: unknown, step: number, message: string): asserts cond {
  if (!cond) throw new StepFailure(step, message);
}

async function fetchJson<T>(
  step: number,
  url: string,
  init?: RequestInit
): Promise<{ status: number; body: T }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw new StepFailure(step, `响应不是合法 JSON（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }
  return { status: res.status, body };
}

// 第 1/2 步共用：required 恰好 14、rows 恰好 10 且每行恰好 3 词、
// duplicateOfRequired 恰好命中黄金 7 词集合。用于同时校验 POST 的落库结果
// 和 GET 的回读结果必须完全一致（D-15 绕行代码删除后的关键判据：如果之前
// 的按 word_id 过滤没删干净，这里 rows 里就会有行少于 3 个词）。
function assertWorksheetShape(step: number, label: string, worksheet: WorksheetResp): void {
  assert(worksheet.required.length === 14, step, `${label}：必听词应为 14 个，实际 ${worksheet.required.length}`);
  assert(worksheet.rows.length === 10, step, `${label}：生字行应为 10 行，实际 ${worksheet.rows.length}`);
  for (const row of worksheet.rows) {
    assert(
      row.words.length === 3,
      step,
      `${label}：第 ${row.rowIndex} 行（${row.char}）应恰好 3 个组词，实际 ${row.words.length}——` +
        `很可能是按 word_id 过滤 required 撞车词的绕行代码没删干净`
    );
  }

  const duplicateWords = worksheet.rows.flatMap((row) => row.words.filter((w) => w.duplicateOfRequired));
  assert(
    duplicateWords.length === 7,
    step,
    `${label}：duplicateOfRequired 为真的词应恰好 7 个，实际 ${duplicateWords.length}` +
      `（${duplicateWords.map((w) => w.text).join("、")}）`
  );
  const duplicateTextSet = new Set(duplicateWords.map((w) => w.text));
  const expectedSet = new Set(GOLDEN_DUPLICATE_TEXTS);
  const missing = GOLDEN_DUPLICATE_TEXTS.filter((t) => !duplicateTextSet.has(t));
  const extra = [...duplicateTextSet].filter((t) => !expectedSet.has(t));
  assert(
    missing.length === 0 && extra.length === 0,
    step,
    `${label}：duplicateOfRequired 命中的词与黄金真值不符——缺失：${missing.join("、") || "无"}，` +
      `多余：${extra.join("、") || "无"}`
  );
}

async function main(): Promise<void> {
  console.log(`[api-smoke] 目标服务器: ${BASE_URL}`);

  // === 第 1 步：上传作业照片 ===
  console.log("\n[1/10] POST /api/worksheet —— 上传 fixtures/worksheet-01.jpg");
  const imagePath = path.resolve(__dirname, "..", "fixtures", "worksheet-01.jpg");
  const imageBuffer = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append("images", new Blob([imageBuffer], { type: "image/jpeg" }), "worksheet-01.jpg");

  const worksheetRes = await fetchJson<WorksheetResp>(1, `${BASE_URL}/api/worksheet`, {
    method: "POST",
    body: form,
  });
  assert(
    worksheetRes.status === 200,
    1,
    `HTTP 状态应为 200，实际 ${worksheetRes.status}：${JSON.stringify(worksheetRes.body)}`
  );
  const worksheet = worksheetRes.body;
  assertWorksheetShape(1, "POST 响应", worksheet);
  console.log(
    `  worksheetId=${worksheet.worksheetId}，必听词 ${worksheet.required.length} 个，生字行 ${worksheet.rows.length} 行`
  );
  console.log("  通过");

  // === 第 2 步：GET 回读（D-19）===
  console.log("\n[2/10] GET /api/worksheet/:id —— 断点续做时的回读");
  const getRes = await fetchJson<WorksheetResp>(2, `${BASE_URL}/api/worksheet/${worksheet.worksheetId}`);
  assert(
    getRes.status === 200,
    2,
    `HTTP 状态应为 200，实际 ${getRes.status}：${JSON.stringify(getRes.body)}`
  );
  const reloaded = getRes.body;
  assert(
    reloaded.worksheetId === worksheet.worksheetId,
    2,
    `worksheetId 应与第 1 步一致，实际 ${reloaded.worksheetId} vs ${worksheet.worksheetId}`
  );
  assertWorksheetShape(2, "GET 回读", reloaded);
  console.log(
    `  回读一致：必听词 ${reloaded.required.length} 个，生字行 ${reloaded.rows.length} 行，每行 3 词，` +
      `duplicateOfRequired 命中 7 个（${GOLDEN_DUPLICATE_TEXTS.join("、")}）`
  );
  console.log("  通过");

  // === 第 3 步：帮我选 ===
  console.log("\n[3/10] POST /api/worksheet/:id/pick —— 每行择一");
  const pickRes = await fetchJson<PickResp>(
    3,
    `${BASE_URL}/api/worksheet/${worksheet.worksheetId}/pick`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
  );
  assert(
    pickRes.status === 200,
    3,
    `HTTP 状态应为 200，实际 ${pickRes.status}：${JSON.stringify(pickRes.body)}`
  );
  const optional = pickRes.body.optional;
  assert(optional.length === 10, 3, `选听词应恰好 10 个，实际 ${optional.length}`);
  const requiredTextSet = new Set(worksheet.required.map((w) => w.text));
  const overlap = optional.filter((w) => requiredTextSet.has(w.text));
  assert(overlap.length === 0, 3, `选听词与必听词有重复：${overlap.map((w) => w.text).join("、")}`);
  // D-17：每个词都要带 rowIndex 和 char，且 10 个 rowIndex 互不重复——证明
  // pickOptional 确实是每行恰好选出一个，而不是从混在一起的候选池里乱选。
  for (const w of optional) {
    assert(
      typeof w.rowIndex === "number" && Number.isInteger(w.rowIndex),
      3,
      `词「${w.text}」缺少合法的 rowIndex：${JSON.stringify(w)}`
    );
    assert(
      typeof w.char === "string" && w.char.length > 0,
      3,
      `词「${w.text}」缺少合法的 char：${JSON.stringify(w)}`
    );
  }
  const rowIndexSet = new Set(optional.map((w) => w.rowIndex));
  assert(
    rowIndexSet.size === 10,
    3,
    `10 个选听词的 rowIndex 应互不重复，实际去重后剩 ${rowIndexSet.size} 个`
  );
  console.log(
    `  选出 ${optional.length} 个：${optional.map((w) => `${w.char}行→${w.text}`).join("、")}`
  );
  console.log("  通过");

  // === 第 4 步：开一次听写会话 ===
  console.log("\n[4/10] POST /api/session —— 必听在前排序");
  const wordIds = [...worksheet.required.map((w) => w.id), ...optional.map((w) => w.id)];
  const sessionRes = await fetchJson<SessionPostResp>(4, `${BASE_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worksheetId: worksheet.worksheetId,
      wordIds,
      settings: { repeat: 3, gapMs: 1500, speed: 1, voice: AUDIO_VOICE },
    }),
  });
  assert(
    sessionRes.status === 200,
    4,
    `HTTP 状态应为 200，实际 ${sessionRes.status}：${JSON.stringify(sessionRes.body)}`
  );
  const session = sessionRes.body;
  assert(session.attempts.length === 24, 4, `听写总数应为 24，实际 ${session.attempts.length}`);
  const bySeq = new Map(session.attempts.map((a) => [a.seq, a]));
  for (let seq = 1; seq <= 14; seq++) {
    const a = bySeq.get(seq);
    assert(a !== undefined && a.bucket === "required", 4, `seq=${seq} 应为 required，实际 ${a?.bucket}`);
  }
  for (let seq = 15; seq <= 24; seq++) {
    const a = bySeq.get(seq);
    assert(a !== undefined && a.bucket === "optional", 4, `seq=${seq} 应为 optional，实际 ${a?.bucket}`);
  }
  console.log(`  sessionId=${session.sessionId}，总数 ${session.attempts.length}，seq 1-14 必听 / 15-24 选听`);
  console.log("  通过");

  // === 第 5 步：取第一个词的音频 ===
  console.log("\n[5/10] GET /api/audio —— 取第 1 个词");
  const firstAttempt = bySeq.get(1)!;
  const audioParams = new URLSearchParams({
    wordId: String(firstAttempt.wordId),
    speed: String(AUDIO_SPEED),
    repeat: String(AUDIO_REPEAT),
    gapMs: String(AUDIO_GAP_MS),
    voice: AUDIO_VOICE,
    seq: String(AUDIO_SEQ),
  });
  const audioUrl = `${BASE_URL}/api/audio?${audioParams.toString()}`;
  const audioRes1 = await fetch(audioUrl);
  assert(audioRes1.status === 200, 5, `HTTP 状态应为 200，实际 ${audioRes1.status}`);
  const contentType1 = audioRes1.headers.get("content-type") ?? "";
  assert(contentType1.startsWith("audio/"), 5, `Content-Type 应是音频，实际 ${contentType1}`);
  const audioBuf1 = Buffer.from(await audioRes1.arrayBuffer());
  assert(audioBuf1.length > 1000, 5, `音频字节数应 > 1000，实际 ${audioBuf1.length}`);
  console.log(`  wordId=${firstAttempt.wordId} Content-Type=${contentType1} 字节数=${audioBuf1.length}`);
  console.log("  通过");

  // === 第 6 步：命中缓存 ===
  console.log("\n[6/10] 再取一次同一个词 —— 断言命中缓存（字节完全一致）");
  const audioRes2 = await fetch(audioUrl);
  assert(audioRes2.status === 200, 6, `HTTP 状态应为 200，实际 ${audioRes2.status}`);
  const audioBuf2 = Buffer.from(await audioRes2.arrayBuffer());
  const cacheHit = audioBuf1.equals(audioBuf2);
  console.log(`  第5步 ${audioBuf1.length} 字节 vs 第6步 ${audioBuf2.length} 字节，完全一致：${cacheHit}`);
  assert(cacheHit, 6, "两次响应字节不一致，说明没有命中缓存");
  console.log("  通过");

  // === 第 7 步：读音修正 -> 缓存失效 ===
  console.log("\n[7/10] PATCH /api/word/:id/tts-text —— 改读音后验证旧缓存失效");
  const originalWord = worksheet.required.find((w) => w.id === firstAttempt.wordId)!;
  const newTtsText = `${originalWord.text}测试改音`;
  // 和路由内部 audioCacheKey() 用一样的参数手算旧/新缓存键，直接检查磁盘缓存
  // 文件是否真的被删/被写——比单纯比较响应字节更能准确证明「缓存确实被清
  // 掉」，原因见下方第 7 步内的说明。
  const oldKey = audioCacheKey({
    ttsText: originalWord.text,
    pinyin: originalWord.pinyin,
    voice: AUDIO_VOICE,
    speed: AUDIO_SPEED,
    repeat: AUDIO_REPEAT,
    gapMs: AUDIO_GAP_MS,
    seqLabel: AUDIO_SEQ,
  });
  const newKey = audioCacheKey({
    ttsText: newTtsText,
    pinyin: originalWord.pinyin,
    voice: AUDIO_VOICE,
    speed: AUDIO_SPEED,
    repeat: AUDIO_REPEAT,
    gapMs: AUDIO_GAP_MS,
    seqLabel: AUDIO_SEQ,
  });
  assert(getCached(oldKey) !== null, 7, "PATCH 之前旧缓存应该已经存在（第 5 步应已写盘）");

  const patchRes = await fetchJson<{ ok: true }>(
    7,
    `${BASE_URL}/api/word/${firstAttempt.wordId}/tts-text`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttsText: newTtsText }),
    }
  );
  assert(
    patchRes.status === 200,
    7,
    `HTTP 状态应为 200，实际 ${patchRes.status}：${JSON.stringify(patchRes.body)}`
  );
  assert(getCached(oldKey) === null, 7, "PATCH 之后旧缓存应该被清掉，但磁盘上仍然存在");

  const audioRes3 = await fetch(audioUrl);
  assert(audioRes3.status === 200, 7, `HTTP 状态应为 200，实际 ${audioRes3.status}`);
  const audioBuf3 = Buffer.from(await audioRes3.arrayBuffer());
  const bytesDiffer = !audioBuf1.equals(audioBuf3);
  const newCacheWritten = getCached(newKey) !== null;
  console.log(`  旧缓存已清掉: ${getCached(oldKey) === null}；新缓存已写入: ${newCacheWritten}`);
  console.log(
    `  字节对比：第5步 ${audioBuf1.length} 字节 vs 第7步 ${audioBuf3.length} 字节，是否不同：${bytesDiffer}`
  );
  if (!bytesDiffer) {
    console.log(
      "  说明：mock TTS 的音频波形只取决于 repeat/gapMs/seqLabel（提示音节奏），不取决于文本内容，" +
        "所以即使缓存确实已失效并重新合成，字节仍可能相同。本步骤以「旧缓存文件被删、新缓存文件被写」" +
        "作为判据，而不是单纯比较字节。"
    );
  }
  assert(newCacheWritten, 7, "改读音后重新合成应该写入一份新的缓存文件，但没有观察到");
  console.log("  通过");

  // === 第 8 步：更新 attempt ===
  console.log("\n[8/10] PATCH /api/attempt/:id —— 一个 skipped，一个 hintLevel=3");
  const skipAttempt = bySeq.get(2)!;
  const hintAttempt = bySeq.get(3)!;
  // POST /api/session 的响应按 §7 只给 {seq,wordId,bucket}，不含 attempt 的
  // 数据库自增 id；用 GET /api/session/:id 反查。
  const sessionFullRes = await fetchJson<SessionFullResp>(8, `${BASE_URL}/api/session/${session.sessionId}`);
  assert(
    sessionFullRes.status === 200,
    8,
    `GET /api/session/:id 应为 200，实际 ${sessionFullRes.status}`
  );
  const attemptIdBySeq = new Map(sessionFullRes.body.attempts.map((a) => [a.seq, a.id]));
  const skipAttemptId = attemptIdBySeq.get(skipAttempt.seq);
  const hintAttemptId = attemptIdBySeq.get(hintAttempt.seq);
  assert(skipAttemptId !== undefined, 8, `找不到 seq=${skipAttempt.seq} 对应的 attemptId`);
  assert(hintAttemptId !== undefined, 8, `找不到 seq=${hintAttempt.seq} 对应的 attemptId`);

  const skipPatch = await fetchJson<{ ok: true }>(8, `${BASE_URL}/api/attempt/${skipAttemptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "skipped", sessionId: session.sessionId, seq: skipAttempt.seq }),
  });
  assert(
    skipPatch.status === 200,
    8,
    `标记 skipped 应为 200，实际 ${skipPatch.status}：${JSON.stringify(skipPatch.body)}`
  );

  const hintPatch = await fetchJson<{ ok: true }>(8, `${BASE_URL}/api/attempt/${hintAttemptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hintLevel: 3, sessionId: session.sessionId, seq: hintAttempt.seq }),
  });
  assert(
    hintPatch.status === 200,
    8,
    `标记 hintLevel=3 应为 200，实际 ${hintPatch.status}：${JSON.stringify(hintPatch.body)}`
  );
  console.log(`  attempt#${skipAttemptId} -> skipped，attempt#${hintAttemptId} -> hintLevel=3`);
  console.log("  通过");

  // === 第 9 步：结束听写 ===
  console.log("\n[9/10] POST /api/session/:id/finish");
  const finishRes = await fetchJson<FinishResp>(9, `${BASE_URL}/api/session/${session.sessionId}/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert(
    finishRes.status === 200,
    9,
    `HTTP 状态应为 200，实际 ${finishRes.status}：${JSON.stringify(finishRes.body)}`
  );
  assert(finishRes.body.skipped === 1, 9, `skipped 应为 1，实际 ${finishRes.body.skipped}`);
  assert(finishRes.body.hintCount === 1, 9, `hintCount 应为 1，实际 ${finishRes.body.hintCount}`);
  console.log(
    `  total=${finishRes.body.total} skipped=${finishRes.body.skipped} hintCount=${finishRes.body.hintCount}`
  );
  console.log("  通过");

  console.log("\n[10/10] 全部步骤通过");
  console.log("\nAPI SMOKE PASS");
}

main().catch((err) => {
  if (err instanceof StepFailure) {
    console.error(`\nAPI SMOKE FAIL: 第 ${err.step} 步 —— ${err.message}`);
  } else {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`\nAPI SMOKE FAIL: 未预期异常 —— ${detail}`);
  }
  process.exitCode = 1;
});

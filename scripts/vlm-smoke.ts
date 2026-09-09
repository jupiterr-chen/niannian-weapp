// 识别样张脚本。用法：npx tsx scripts/vlm-smoke.ts
// 读 fixtures/worksheet-01.jpg，调用 provider.recognize() 再过 crossCheckPinyin，
// 和 tests/fixtures/worksheet-01.ts 的黄金真值逐项比对，打印对照报告。
// mock provider 下应当 100% PASS——这是脚本自身正确性的自检。
import fs from "node:fs";
import path from "node:path";
import { crossCheckPinyin, getVlmProvider } from "../lib/vlm";
import type { RecognizedWord } from "../lib/vlm";
import { EXPECTED_REQUIRED_COUNT, EXPECTED_ROW_COUNT, REQUIRED_WORDS, ROWS } from "../tests/fixtures/worksheet-01";

function compareWord(
  got: RecognizedWord,
  goldenPinyin: string | undefined,
  ctx: string,
  mismatches: string[]
): void {
  if (goldenPinyin === undefined) return; // 黄金真值里没有这个词，交给别的检查项报告
  if (got.pinyin !== goldenPinyin) {
    mismatches.push(`${ctx}${got.text}: 返回=${got.pinyin} 黄金真值=${goldenPinyin}`);
  }
}

async function main(): Promise<void> {
  const imagePath = path.resolve(__dirname, "..", "fixtures", "worksheet-01.jpg");
  const image = fs.readFileSync(imagePath);

  const provider = getVlmProvider();
  const raw = await provider.recognize([image]);
  const result = crossCheckPinyin(raw);

  const problems: string[] = [];

  // --- 必听词 ---
  const goldenRequired = new Map(REQUIRED_WORDS.map((w) => [w.text, w.pinyin]));
  const gotRequiredTexts = result.required.map((w) => w.text);
  const gotRequiredSet = new Set(gotRequiredTexts);
  const missingRequired = [...goldenRequired.keys()].filter((t) => !gotRequiredSet.has(t));
  const extraRequired = gotRequiredTexts.filter((t) => !goldenRequired.has(t));
  const recall = ((goldenRequired.size - missingRequired.length) / goldenRequired.size) * 100;

  console.log("=== 必听词 ===");
  console.log(
    `应有 ${goldenRequired.size} 个，实际返回 ${result.required.length} 个，召回率 ${recall.toFixed(1)}%`
  );
  console.log(`漏了：${missingRequired.length ? missingRequired.join("、") : "(无)"}`);
  console.log(`多了：${extraRequired.length ? extraRequired.join("、") : "(无)"}`);
  if (result.required.length !== EXPECTED_REQUIRED_COUNT) {
    problems.push(`必听词数量应为 ${EXPECTED_REQUIRED_COUNT}，实际 ${result.required.length}`);
  }
  if (missingRequired.length) problems.push(`必听词漏了：${missingRequired.join("、")}`);
  if (extraRequired.length) problems.push(`必听词多了：${extraRequired.join("、")}`);

  // --- 生字行 ---
  console.log("\n=== 生字行 ===");
  console.log(`应有 ${EXPECTED_ROW_COUNT} 行，实际 ${result.rows.length} 行`);
  if (result.rows.length !== EXPECTED_ROW_COUNT) {
    problems.push(`生字行数应为 ${EXPECTED_ROW_COUNT}，实际 ${result.rows.length}`);
  }
  const rowCount = Math.min(result.rows.length, ROWS.length);
  for (let i = 0; i < rowCount; i++) {
    const got = result.rows[i];
    const golden = ROWS[i];
    const charOk = got.char === golden.char;
    const wordCountOk = got.words.length === golden.words.length;
    console.log(
      `  行${i}: 生字=${got.char}${charOk ? "" : `（应为 ${golden.char}）`}, 组词数=${got.words.length}${
        wordCountOk ? "" : `（应为 ${golden.words.length}）`
      }`
    );
    if (!charOk) problems.push(`第 ${i} 行生字应为「${golden.char}」，实际「${got.char}」`);
    if (!wordCountOk) problems.push(`第 ${i} 行组词数应为 ${golden.words.length}，实际 ${got.words.length}`);
  }

  // --- 拼音逐词比对 ---
  console.log("\n=== 拼音比对 ===");
  const pinyinMismatches: string[] = [];
  for (const w of result.required) {
    compareWord(w, goldenRequired.get(w.text), "[必听] ", pinyinMismatches);
  }
  for (let i = 0; i < rowCount; i++) {
    const got = result.rows[i];
    const golden = ROWS[i];
    const goldenWordMap = new Map(golden.words.map((w) => [w.text, w.pinyin]));
    for (const w of got.words) {
      compareWord(w, goldenWordMap.get(w.text), `[行${i}] `, pinyinMismatches);
    }
  }
  if (pinyinMismatches.length === 0) {
    console.log("  全部一致");
  } else {
    for (const m of pinyinMismatches) console.log(`  ${m}`);
    problems.push(...pinyinMismatches.map((m) => `拼音不一致: ${m}`));
  }

  if (result.warnings.length) {
    console.log("\n=== provider warnings（含 crossCheckPinyin 追加的存疑项，不计入 PASS/FAIL）===");
    for (const w of result.warnings) console.log(`  ${w}`);
  }

  console.log("\n" + (problems.length === 0 ? "PASS" : `FAIL: ${problems.join("; ")}`));
  if (problems.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[vlm-smoke] 未捕获异常：", err);
  process.exitCode = 1;
});

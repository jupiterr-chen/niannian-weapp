// 多音字试音脚本，兼做 §10.6 音频装配的正确性校验。用法：
//   npx tsx scripts/tts-smoke.ts
//
// 必须先加载 .env.local（见 scripts/_env.ts 顶部注释：tsx 跑脚本不是
// Next.js，不会自动读 .env.local），再动态 import 所有会读 process.env 的
// lib 模块——否则脚本永远只能验证 mock，读不到用户配置的真实密钥。
import { loadDotEnv } from "./_env";
loadDotEnv();

import fs from "node:fs";
import path from "node:path";
import { readWavInfo } from "../lib/tts/wav";

// §8「必须读对的多音字」清单，外加「四海为家」（无多音字歧义，但同样出现
// 在黄金真值的必听词里，一并试音）。
const WORDS = ["长大", "一本正经", "心知肚明", "识别", "常识", "发现", "出发", "四海为家"];

function maskToken(token: string): string {
  if (!token) return "(未配置)";
  const visible = token.slice(0, 4);
  return `${visible}${"*".repeat(Math.max(0, token.length - 4))}`;
}

interface WordResult {
  word: string;
  pinyin: string;
  dictEntry: string;
  ok: boolean;
  file?: string;
  error?: string;
}

async function main(): Promise<void> {
  // lib/env 及其下游（lib/tts、lib/tts/volcano、lib/pinyin）都必须在
  // loadDotEnv() 之后才 import，否则 lib/env.ts 会用加载前的空 process.env
  // 算出降级结果，之后再怎么 import 都不会重新计算。
  const { env, paths, ensureDataDirs } = await import("../lib/env");
  const { getTtsProvider } = await import("../lib/tts");
  const { toPinyin } = await import("../lib/pinyin");
  const { buildPronunciationEntry } = await import("../lib/tts/volcano");
  const { MULTI_PINYIN_WORDS } = await import("../tests/fixtures/worksheet-01");

  ensureDataDirs();

  console.log("[tts-smoke] ==== provider 状态 ====");
  if (env.ttsProvider === "mock") {
    console.log("!".repeat(70));
    console.log(
      "[tts-smoke] provider = mock —— 未检测到 VOLC_TTS_API_KEY / VOLC_TTS_SPEAKER，" +
        "或未加载到 .env.local。"
    );
    console.log(
      "[tts-smoke] 以下所有音频都只是提示音（正弦波），不含真实语音，不能用来验证" +
        "任何一个字的读音对不对！"
    );
    console.log("!".repeat(70));
  } else {
    console.log("[tts-smoke] provider = volcano（真实合成）");
  }
  console.log(`[tts-smoke] VOLC_TTS_BASE_URL    = ${env.volcTtsBaseUrl}`);
  console.log(`[tts-smoke] VOLC_TTS_API_KEY     = ${maskToken(env.volcTtsApiKey)}`);
  console.log(`[tts-smoke] VOLC_TTS_RESOURCE_ID = ${env.volcTtsResourceId}`);
  console.log(`[tts-smoke] VOLC_TTS_SPEAKER     = ${env.volcTtsSpeaker || "(未配置)"}`);
  console.log(`[tts-smoke] VOLC_TTS_SAMPLE_RATE = ${env.volcTtsSampleRate}`);

  const provider = getTtsProvider();
  const outDir = path.join(paths.data, "smoke");
  fs.mkdirSync(outDir, { recursive: true });

  // --- 逐词试音：同时打印实际会发给火山的发音词典条目，供人眼核对 ---
  console.log("\n[tts-smoke] ==== 逐词试音 + 发音词典条目 ====");
  const results: WordResult[] = [];
  for (const word of WORDS) {
    // 优先用黄金真值里的正确读音（多音字必须用课文语境的那个读音去注音，
    // 不能直接对词面调用 toPinyin 现算——那正是这个脚本要验证 provider
    // 有没有把这个正确读音真的念出来）。
    const pinyin = MULTI_PINYIN_WORDS[word] ?? toPinyin(word);
    const dictEntry = buildPronunciationEntry(word, pinyin);
    const dictEntryStr = dictEntry ? dictEntry.entry : "(未生成：超过 9 字符 / 含空格 / 音节数对不齐)";
    console.log(`  ${word} (${pinyin}) -> 发音词典条目: ${dictEntryStr}`);

    try {
      const { audio, mime } = await provider.synthesize({
        text: word,
        pinyin,
        voice: env.volcTtsVoice,
        speed: env.ttsSpeed,
        repeat: 3,
        gapMs: env.ttsGapMs,
      });
      const ext = mime === "audio/wav" ? ".wav" : ".mp3";
      const filePath = path.join(outDir, `${word}${ext}`);
      fs.writeFileSync(filePath, audio);
      results.push({ word, pinyin, dictEntry: dictEntryStr, ok: true, file: filePath });
    } catch (err) {
      results.push({
        word,
        pinyin,
        dictEntry: dictEntryStr,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("\n[tts-smoke] 逐词结果：");
  for (const r of results) {
    if (r.ok) {
      console.log(`  OK   ${r.word} (${r.pinyin}) -> ${r.file}`);
    } else {
      console.log(`  FAIL ${r.word} (${r.pinyin}): ${r.error}`);
    }
  }
  const okResults = results.filter((r) => r.ok);
  console.log(`\n[tts-smoke] 共 ${okResults.length}/${WORDS.length} 个成功，文件路径（绝对路径）：`);
  for (const r of okResults) {
    console.log(`  ${path.resolve(r.file!)}`);
  }
  if (env.ttsProvider !== "mock") {
    console.log("\n请逐个播放，重点确认「长大」读的是 zhǎng 不是 cháng。");
  }

  // --- 装配正确性校验（§10.6）---
  // 黑盒验证思路：不偷看 lib/tts/volcano.ts 内部的分件缓存，只用公开的
  // synthesize() 接口，通过三次不同参数的调用反推「词时长」「序号段时长」，
  // 再据此算出完整装配（repeat=3 + 可选序号段）应有的时长，和实际装配结果
  // 的时长比较。这样测的是 SynthOutput 这个公开契约的行为，不依赖内部实现。
  console.log("\n[tts-smoke] ==== 装配正确性校验 ====");
  let assemblyOk = true;
  try {
    const verifyWord = "长大";
    const verifyPinyin = MULTI_PINYIN_WORDS[verifyWord];
    const gapMs = env.ttsGapMs;
    const gapSec = gapMs / 1000;
    const seqLabel = 5;

    const wordOnly = await provider.synthesize({
      text: verifyWord,
      pinyin: verifyPinyin,
      voice: env.volcTtsVoice,
      speed: env.ttsSpeed,
      repeat: 1,
      gapMs: 0,
      // 无 seqLabel：只有一个词，没有任何间隔——纯粹测出「词」本身的时长。
    });
    const wordInfo = readWavInfo(wordOnly.audio);

    const labelPlusWord = await provider.synthesize({
      text: verifyWord,
      pinyin: verifyPinyin,
      voice: env.volcTtsVoice,
      speed: env.ttsSpeed,
      repeat: 1,
      gapMs,
      seqLabel,
    });
    const labelPlusWordInfo = readWavInfo(labelPlusWord.audio);
    // repeat=1 + seqLabel 时装配是 [序号][间隔][词]，只有一个间隔，可以反推
    // 出序号段单独的时长。
    const labelDurSec = labelPlusWordInfo.durationSec - gapSec - wordInfo.durationSec;

    const fullWithLabel = await provider.synthesize({
      text: verifyWord,
      pinyin: verifyPinyin,
      voice: env.volcTtsVoice,
      speed: env.ttsSpeed,
      repeat: 3,
      gapMs,
      seqLabel,
    });
    const fullWithLabelInfo = readWavInfo(fullWithLabel.audio);
    // [序号][间隔][词][间隔][词][间隔][词] —— 3 个间隔。
    const expectedWithLabelSec = labelDurSec + wordInfo.durationSec * 3 + gapSec * 3;

    const fullNoLabel = await provider.synthesize({
      text: verifyWord,
      pinyin: verifyPinyin,
      voice: env.volcTtsVoice,
      speed: env.ttsSpeed,
      repeat: 3,
      gapMs,
    });
    const fullNoLabelInfo = readWavInfo(fullNoLabel.audio);
    // [词][间隔][词][间隔][词] —— 2 个间隔，没有序号段。
    const expectedNoLabelSec = wordInfo.durationSec * 3 + gapSec * 2;

    const TOLERANCE_MS = 5; // 静音段按采样数取整带来的误差，量级远小于这个阈值

    const checks: Array<{ label: string; info: ReturnType<typeof readWavInfo>; expectedSec: number }> = [
      { label: "有序号段（3×间隔）", info: fullWithLabelInfo, expectedSec: expectedWithLabelSec },
      { label: "无序号段（2×间隔）", info: fullNoLabelInfo, expectedSec: expectedNoLabelSec },
    ];

    console.log(`  校验词: ${verifyWord} (${verifyPinyin})，gapMs=${gapMs}，序号=${seqLabel}`);
    console.log(`  单词时长实测: ${(wordInfo.durationSec * 1000).toFixed(1)}ms`);
    console.log(`  序号段时长反推: ${(labelDurSec * 1000).toFixed(1)}ms`);

    for (const check of checks) {
      const info = check.info;
      const headerValid = info.valid && info.sampleRate > 0 && info.bitsPerSample === 16 && info.channels === 1;
      const diffMs = Math.abs(info.durationSec - check.expectedSec) * 1000;
      const withinTolerance = diffMs <= TOLERANCE_MS;
      if (!headerValid || !withinTolerance) assemblyOk = false;
      console.log(
        `  [${check.label}] header合法=${headerValid} 预期=${(check.expectedSec * 1000).toFixed(1)}ms ` +
          `实测=${(info.durationSec * 1000).toFixed(1)}ms 差值=${diffMs.toFixed(2)}ms ` +
          `${withinTolerance ? "PASS" : "FAIL"}`
      );
    }
  } catch (err) {
    assemblyOk = false;
    console.log(`  装配校验过程本身抛出异常：${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(`\n[tts-smoke] 装配校验结论：${assemblyOk ? "PASS" : "FAIL"}`);

  if (okResults.length < WORDS.length || !assemblyOk) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[tts-smoke] 未捕获异常：", err);
  process.exitCode = 1;
});

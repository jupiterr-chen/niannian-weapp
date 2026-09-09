// 多音字试音脚本。用法：npx tsx scripts/tts-smoke.ts
// 合成 §8 黄金真值里点名的多音字清单，每词 repeat=3，写到 data/smoke/ 下，
// 供人耳逐个播放核对。任何一个词失败都不中断整批，最后一起报告。
import fs from "node:fs";
import path from "node:path";
import { env, paths, ensureDataDirs } from "../lib/env";
import { getTtsProvider } from "../lib/tts";
import { toPinyin } from "../lib/pinyin";
import { MULTI_PINYIN_WORDS } from "../tests/fixtures/worksheet-01";

// §8「必须读对的多音字」清单，外加 四海为家（无多音字歧义，但同样出现在
// 黄金真值的必听词里，一并试音）。
const WORDS = ["长大", "一本正经", "心知肚明", "识别", "常识", "发现", "出发", "四海为家"];

function maskToken(token: string): string {
  if (!token) return "(未配置)";
  const visible = token.slice(0, 4);
  return `${visible}${"*".repeat(Math.max(0, token.length - 4))}`;
}

interface WordResult {
  word: string;
  pinyin: string;
  ok: boolean;
  file?: string;
  error?: string;
}

async function main(): Promise<void> {
  ensureDataDirs();

  console.log(`[tts-smoke] provider = ${env.ttsProvider}`);
  console.log(`[tts-smoke] VOLC_TTS_BASE_URL = ${env.volcTtsBaseUrl}`);
  console.log(`[tts-smoke] VOLC_TTS_APP_ID = ${env.volcTtsAppId || "(未配置)"}`);
  console.log(`[tts-smoke] VOLC_TTS_ACCESS_TOKEN = ${maskToken(env.volcTtsAccessToken)}`);
  console.log(`[tts-smoke] VOLC_TTS_CLUSTER = ${env.volcTtsCluster}`);
  console.log(`[tts-smoke] VOLC_TTS_VOICE = ${env.volcTtsVoice || "(未配置)"}`);
  console.log(`[tts-smoke] VOLC_TTS_SSML = ${env.volcTtsSsml}`);

  const provider = getTtsProvider();
  const outDir = path.join(paths.data, "smoke");
  fs.mkdirSync(outDir, { recursive: true });

  const results: WordResult[] = [];

  for (const word of WORDS) {
    // 优先用黄金真值里的正确读音（多音字必须用课文语境的那个读音去注音，
    // 不能直接对词面调用 toPinyin 现算——那正是这个脚本要验证 provider
    // 有没有把这个正确读音真的念出来）。
    const pinyin = MULTI_PINYIN_WORDS[word] ?? toPinyin(word);
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
      results.push({ word, pinyin, ok: true, file: filePath });
    } catch (err) {
      results.push({ word, pinyin, ok: false, error: err instanceof Error ? err.message : String(err) });
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
  console.log(`\n共 ${okResults.length}/${WORDS.length} 个成功，文件路径：`);
  for (const r of okResults) {
    console.log(`  ${r.file}`);
  }
  console.log("\n请逐个播放，重点确认「长大」读的是 zhǎng 不是 cháng。");

  if (okResults.length < WORDS.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[tts-smoke] 未捕获异常：", err);
  process.exitCode = 1;
});

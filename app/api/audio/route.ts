// GET /api/audio —— 前端预取的性能关键路径。见 PROJECT.md §4.5、§5.4、§11 D-11。
import fs from "node:fs";
import { NextResponse } from "next/server";
import { env } from "../../../lib/env";
import { ApiError, handler } from "../../../lib/api/errors";
import { getWordsByIds } from "../../../lib/db/queries";
import { getTtsProvider } from "../../../lib/tts";
import { getCached, putCache } from "../../../lib/tts/cache";
import { audioCacheKey } from "../../../lib/core/cachekey";

export const runtime = "nodejs";

function parsePositiveNumber(raw: string | null, fallback: number, label: string): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError("invalid_query", 400, `${label} 参数不对`);
  }
  return n;
}

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const wordIdRaw = url.searchParams.get("wordId");
  if (wordIdRaw === null) {
    throw new ApiError("invalid_query", 400, "缺少 wordId 参数");
  }
  const wordId = Number(wordIdRaw);
  if (!Number.isInteger(wordId) || wordId <= 0) {
    throw new ApiError("invalid_query", 400, "wordId 必须是正整数");
  }

  const speed = parsePositiveNumber(url.searchParams.get("speed"), env.ttsSpeed, "speed");
  const repeat = parsePositiveNumber(url.searchParams.get("repeat"), env.ttsRepeat, "repeat");
  const gapMs = parsePositiveNumber(url.searchParams.get("gapMs"), env.ttsGapMs, "gapMs");
  const voice = url.searchParams.get("voice") ?? env.volcTtsVoice;
  const seqRaw = url.searchParams.get("seq");
  const seqLabel = seqRaw === null || seqRaw === "" ? undefined : Number(seqRaw);
  if (seqLabel !== undefined && (!Number.isInteger(seqLabel) || seqLabel <= 0)) {
    throw new ApiError("invalid_query", 400, "seq 必须是正整数");
  }

  const word = getWordsByIds([wordId])[0];
  if (!word) {
    throw new ApiError("word_not_found", 404, "找不到这个词");
  }

  const ttsText = word.ttsText ?? word.text;
  const key = audioCacheKey({ ttsText, pinyin: word.pinyin, voice, speed, repeat, gapMs, seqLabel });

  const cached = getCached(key);
  if (cached) {
    const audio = fs.readFileSync(cached.path);
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": cached.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  let synth;
  try {
    synth = await getTtsProvider().synthesize({
      text: ttsText,
      pinyin: word.pinyin,
      voice,
      speed,
      repeat,
      gapMs,
      seqLabel,
    });
  } catch (err) {
    console.error("[api/audio] TTS 合成失败:", err);
    throw new ApiError(
      "tts_unavailable",
      503,
      "语音合成暂时不可用，稍后会自动改用手机自带的朗读功能"
    );
  }

  const headers: Record<string, string> = { "Content-Type": synth.mime };

  // D-11：降级音频（SSML 回落纯文本）绝不进持久缓存，否则一个读错的多音字
  // 会无声无息地天天错下去。前端据 X-TTS-Degraded 头显示「读音可能不准」。
  if (synth.degraded) {
    headers["X-TTS-Degraded"] = "1";
    headers["Cache-Control"] = "no-store";
  } else {
    putCache(key, synth.audio, synth.mime, { ttsText, pinyin: word.pinyin });
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }

  return new NextResponse(new Uint8Array(synth.audio), { status: 200, headers });
});

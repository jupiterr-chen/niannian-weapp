// 音频磁盘缓存。键统一用 lib/core/cachekey.ts 的 audioCacheKey() 计算，本文件
// 不重复实现哈希逻辑。所有文件操作都容错：目录不存在就建，读/写/删失败就当
// 作缓存未命中/清理失败处理，绝不抛异常打断听写（§5.4「任何一步失败都不得
// 白屏或卡死」同样适用于缓存层）。
import fs from "node:fs";
import path from "node:path";
import { paths } from "../env";

export interface CacheEntry {
  path: string;
  mime: string;
}

// D-10：ttsText/pinyin 不再可选——invalidateWord 反查删除全靠 index.json 里
// 这两个字段，可选参数迟早会被某个调用点忘记传，后果是读音修正后旧缓存清
// 不掉。degraded 可选，默认不降级；见 putCache 里对它的处理（D-11）。
export interface CacheMeta {
  ttsText: string;
  pinyin: string;
  degraded?: boolean;
}

// D-11：SSML 注音被拒绝、回落纯文本产生的音频不能进持久缓存——那样一个读错
// 的多音字会天天错下去，而且无声无息。用专门的错误类型而不是返回 null，
// 让"忘记检查返回值"这种疏忽不可能悄悄放过一次降级写盘。
export class DegradedAudioCacheError extends Error {
  constructor() {
    super(
      "拒绝缓存降级音频：SSML 注音被拒绝后回落纯文本得到的结果不可信，写入持久缓存会把" +
        "错误读音永久固化。调用方应改为直接把 audio 返回给前端，并设置 X-TTS-Degraded 响应头。"
    );
    this.name = "DegradedAudioCacheError";
  }
}

// mime -> 落盘扩展名。真实火山接口固定返回 mp3，mock 返回 wav（D-8/D-9）。
const MIME_TO_EXT: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};
const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

function extFor(mime: string): string {
  return MIME_TO_EXT[mime] ?? ".bin";
}

interface IndexEntry {
  ttsText: string;
  pinyin: string;
  ext: string;
}
type IndexMap = Record<string, IndexEntry>;

function indexFilePath(): string {
  return path.join(paths.audio, "index.json");
}

function readIndex(): IndexMap {
  try {
    const raw = fs.readFileSync(indexFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as IndexMap;
    return {};
  } catch {
    // 文件不存在 / 损坏 / 权限问题：当作空索引。invalidateWord 会因此少删
    // 一些孤儿文件，但不影响听写本身能不能跑。
    return {};
  }
}

function writeIndex(index: IndexMap): void {
  try {
    fs.mkdirSync(paths.audio, { recursive: true });
    fs.writeFileSync(indexFilePath(), JSON.stringify(index), "utf8");
  } catch {
    // 索引写失败不应该影响本次缓存写入是否成功，见 putCache。
  }
}

function filePathFor(key: string, ext: string): string {
  return path.join(paths.audio, `${key}${ext}`);
}

export function getCached(key: string): CacheEntry | null {
  try {
    const index = readIndex();
    const knownExt = index[key]?.ext;
    const candidateExts = knownExt ? [knownExt] : Object.keys(EXT_TO_MIME);
    for (const ext of candidateExts) {
      const filePath = filePathFor(key, ext);
      if (fs.existsSync(filePath)) {
        return { path: filePath, mime: EXT_TO_MIME[ext] ?? "application/octet-stream" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// meta 是必填的第四参数（D-10）：调用方（预期是 GET /api/audio 首次合成写
// 缓存那条路径）必须把 (ttsText, pinyin) 一起传进来，写进 index.json，这样
// invalidateWord 才能反查到要删哪些文件。
//
// meta.degraded 为 true（D-11：SSML 被拒绝、回落纯文本的结果）时直接拒绝写
// 盘并抛 DegradedAudioCacheError——调用方应该在拿到 synthesize() 结果时就
// 已经据 degraded 决定跳过 putCache、改为直接回传音频并打 X-TTS-Degraded 响
// 应头；这里的拒绝是第二道防线，防止那处调用点漏判。
export function putCache(key: string, audio: Buffer, mime: string, meta: CacheMeta): string {
  if (meta.degraded) {
    throw new DegradedAudioCacheError();
  }

  const ext = extFor(mime);
  const filePath = filePathFor(key, ext);
  try {
    fs.mkdirSync(paths.audio, { recursive: true });
    fs.writeFileSync(filePath, audio);
  } catch {
    // 落盘失败：调用方仍可以把 audio 直接回给前端，只是这次没有缓存下来。
  }
  const index = readIndex();
  index[key] = { ttsText: meta.ttsText, pinyin: meta.pinyin, ext };
  writeIndex(index);
  return filePath;
}

// §5.3 第 3 层兜底（PATCH /api/word/:id/tts-text）修正读音后，删掉该词在
// 所有参数组合（voice/speed/repeat/gapMs/seqLabel）下的旧缓存文件，避免家长
// 听到修正前的错误读音。
export function invalidateWord(ttsText: string, pinyin: string): void {
  const index = readIndex();
  let changed = false;
  const remaining: IndexMap = {};
  for (const [key, entry] of Object.entries(index)) {
    if (entry.ttsText === ttsText && entry.pinyin === pinyin) {
      changed = true;
      try {
        fs.unlinkSync(filePathFor(key, entry.ext));
      } catch {
        // 文件已经不在了，或者删不掉；仍然把这条记录从索引里摘掉，避免
        // index.json 无限膨胀。
      }
    } else {
      remaining[key] = entry;
    }
  }
  if (changed) writeIndex(remaining);
}

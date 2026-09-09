// POST /api/worksheet —— 上传作业照片，跑 VLM 识别，落库。见 PROJECT.md §7。
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { paths } from "../../../lib/env";
import { ApiError, handler, ok } from "../../../lib/api/errors";
import { crossCheckPinyin, getVlmProvider, type RecognizeResult } from "../../../lib/vlm";
import {
  createWorksheet,
  saveWorksheetWords,
  upsertWord,
  type RowInput,
  type WordInput,
} from "../../../lib/db/queries";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function extFor(file: File): string {
  const byMime = EXT_BY_MIME[file.type];
  if (byMime) return byMime;
  const byName = path.extname(file.name);
  return byName || ".bin";
}

interface RecognizedWordOut {
  id: number;
  text: string;
  pinyin: string;
  pinyinUncertain: boolean;
}

interface RecognizedRowOut {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: RecognizedWordOut[];
}

export const POST = handler(async (request: Request) => {
  const formData = await request.formData();
  const files = formData.getAll("images").filter((v): v is File => v instanceof File);

  if (files.length === 0) {
    throw new ApiError("no_images", 400, "请至少上传一张图片");
  }
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new ApiError(
        "image_too_large",
        400,
        `图片「${file.name}」超过 10MB，请压缩后重新上传`
      );
    }
    if (!file.type.startsWith("image/")) {
      throw new ApiError("invalid_image_type", 400, `文件「${file.name}」不是图片格式`);
    }
  }

  // 先落盘、再识别：无论 VLM 是否成功，图片和 worksheet 记录都不能丢
  // （PROJECT.md 任务书要求 4：VLM 失败不能丢数据）。
  fs.mkdirSync(paths.images, { recursive: true });
  const saved: { relPath: string; buffer: Buffer }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const relPath = `${randomUUID()}${extFor(file)}`;
    fs.writeFileSync(path.join(paths.images, relPath), buffer);
    saved.push({ relPath, buffer });
  }
  const imagePaths = saved.map((s) => s.relPath);

  let recognized: RecognizeResult;
  try {
    const raw = await getVlmProvider().recognize(saved.map((s) => s.buffer));
    recognized = crossCheckPinyin(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const worksheetId = createWorksheet({
      images: imagePaths,
      rawOcr: JSON.stringify({ error: message }),
    });
    // 非标准信封：额外带上 worksheetId，方便家长在识别失败时改走手动输入
    // （PATCH /api/worksheet/:id）。§7 的错误信封只规定了 error 字段，这里
    // 是为了不丢数据而做的必要扩展，见任务报告。
    return NextResponse.json(
      {
        error: {
          code: "vlm_recognition_failed",
          message: "图片识别失败了，你可以改用手动输入词语。",
        },
        worksheetId,
      },
      { status: 502 }
    );
  }

  const worksheetId = createWorksheet({
    title: recognized.title,
    images: imagePaths,
    rawOcr: JSON.stringify(recognized),
  });

  const requiredInput: WordInput[] = recognized.required.map((w) => ({
    wordId: upsertWord(w.text, w.pinyin),
  }));
  const requiredWordIdSet = new Set(requiredInput.map((r) => r.wordId));

  // 黄金真值里常见「如果」既是必听词、又是「如」这一行的组词候选，两处
  // upsertWord(text, pinyin) 落到同一个 word.id。worksheet_word 的主键是
  // (worksheet_id, word_id)，同一个 word_id 不能在同一张 worksheet 里既插
  // required 又插 optional 一份——这是 lib/db/queries.ts 的 schema 限制，不
  // 在本任务可改动的文件范围内。反正 pickOptional 本来就会按文本把这类词
  // 从候选里过滤掉（不影响“帮我选”结果），所以落库前按 word_id 去重即可；
  // 完整的 3 词展示仍然从 rowWordIdsAll（未去重）组出，原样返回给家长。
  const rowWordIdsAll: number[][] = recognized.rows.map((row) =>
    row.words.map((w) => upsertWord(w.text, w.pinyin))
  );
  const rowsInput: RowInput[] = recognized.rows.map((row, rowIndex) => ({
    char: row.char,
    pinyin: row.pinyin,
    rowIndex,
    wordIds: rowWordIdsAll[rowIndex].filter((id) => !requiredWordIdSet.has(id)),
  }));

  saveWorksheetWords(worksheetId, requiredInput, rowsInput);

  const required: RecognizedWordOut[] = recognized.required.map((w, i) => ({
    id: requiredInput[i].wordId,
    text: w.text,
    pinyin: w.pinyin,
    pinyinUncertain: w.pinyinUncertain ?? false,
  }));
  const rows: RecognizedRowOut[] = recognized.rows.map((row, rowIndex) => ({
    char: row.char,
    pinyin: row.pinyin,
    rowIndex,
    words: row.words.map((w, j) => ({
      id: rowWordIdsAll[rowIndex][j],
      text: w.text,
      pinyin: w.pinyin,
      pinyinUncertain: w.pinyinUncertain ?? false,
    })),
  }));

  return ok({
    worksheetId,
    title: recognized.title ?? null,
    required,
    rows,
    warnings: recognized.warnings,
  });
});

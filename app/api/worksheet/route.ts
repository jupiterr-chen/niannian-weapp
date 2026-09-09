// POST /api/worksheet —— 上传作业照片，跑 VLM 识别，落库。见 PROJECT.md §7。
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { paths } from "../../../lib/env";
import { ApiError, handler, ok } from "../../../lib/api/errors";
import { crossCheckPinyin, getVlmProvider, type RecognizeResult } from "../../../lib/vlm";
import { normalize } from "../../../lib/core/normalize";
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

interface RequiredWordOut {
  id: number;
  text: string;
  pinyin: string;
  pinyinUncertain: boolean;
}

interface RowWordOut extends RequiredWordOut {
  // D-20：是否与某个必听词 normalize() 后相同，权威算法在
  // lib/core/normalize.ts，前端不做任何文本归一化。
  duplicateOfRequired: boolean;
}

interface RecognizedRowOut {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: RowWordOut[];
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

  // D-15：worksheet_word 主键已扩为 (worksheet_id, word_id, bucket)，「如果」
  // 这类既是必听词、又是某行组词候选的词现在可以如实入库两份。这里不再按
  // word_id 过滤——存的必须是未过滤的完整行（每行 3 词），否则库里存的和
  // 家长在页面上看到的会不一致，刷新后内容就变了。剔重完全交给
  // pickOptional（按文本 normalize 过滤），它本来就是这么设计的。
  const rowWordIdsAll: number[][] = recognized.rows.map((row) =>
    row.words.map((w) => upsertWord(w.text, w.pinyin))
  );
  const rowsInput: RowInput[] = recognized.rows.map((row, rowIndex) => ({
    char: row.char,
    pinyin: row.pinyin,
    rowIndex,
    wordIds: rowWordIdsAll[rowIndex],
  }));

  saveWorksheetWords(worksheetId, requiredInput, rowsInput);

  const requiredNormSet = new Set(recognized.required.map((w) => normalize(w.text)));

  const required: RequiredWordOut[] = recognized.required.map((w, i) => ({
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
      duplicateOfRequired: requiredNormSet.has(normalize(w.text)),
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

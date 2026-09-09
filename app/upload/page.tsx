"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BigButton } from "@/components/BigButton";

interface PickedImage {
  id: string;
  file: File;
  previewUrl: string;
}

// 与 app/api/worksheet/route.ts 的成功响应体对齐（只读该文件确认过字段名）。
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
interface WorksheetSuccess {
  worksheetId: number;
  title: string | null;
  required: RecognizedWordOut[];
  rows: RecognizedRowOut[];
  warnings: string[];
}
interface ErrorEnvelope {
  error: { code: string; message: string };
  worksheetId?: number;
}

function isErrorEnvelope(v: unknown): v is ErrorEnvelope {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.error === "object" &&
    e.error !== null &&
    typeof (e.error as Record<string, unknown>).message === "string"
  );
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `img-${idSeq}`;
}

export default function UploadPage() {
  const router = useRouter();
  const [images, setImages] = useState<PickedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 缩略图用的 object URL 必须自己撤销，否则每选一批图就泄漏一批内存。
  useEffect(() => {
    return () => {
      for (const img of images) URL.revokeObjectURL(img.previewUrl);
    };
    // 只在卸载时整体清理，images 变化时的逐项清理在 removeImage 里做。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const picked: PickedImage[] = Array.from(fileList).map((file) => ({
      id: nextId(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...picked]);
    setError(null);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const resetAll = useCallback(() => {
    setImages((prev) => {
      for (const img of prev) URL.revokeObjectURL(img.previewUrl);
      return [];
    });
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const submit = useCallback(async () => {
    if (images.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      for (const img of images) formData.append("images", img.file);

      const res = await fetch("/api/worksheet", { method: "POST", body: formData });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message = isErrorEnvelope(body) ? body.error.message : "识别失败了，请重新试试";
        setError(message);
        setSubmitting(false);
        return;
      }

      const worksheet = body as WorksheetSuccess;
      // PROJECT.md §11 D-19：选词页现在直接用 GET /api/worksheet/:id 做单一
      // 数据源（刷新也能恢复），这里不用再把识别结果暂存到 sessionStorage
      // 传给下一页了。
      router.push(`/select/${worksheet.worksheetId}`);
    } catch {
      setError("网络好像断开了，请检查网络后重试");
      setSubmitting(false);
    }
  }, [images, submitting, router]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-8">
      <h1 className="text-[24px] font-bold">上传今天的作业</h1>

      {error && (
        <div className="rounded-xl border-2 border-[var(--color-danger)] bg-[var(--color-danger-bg)] p-4 text-[17px] text-[var(--color-danger)]">
          <p>{error}</p>
          <button
            type="button"
            onClick={resetAll}
            className="focus-ring tap-target mt-3 w-full rounded-xl border-2 border-[var(--color-danger)] text-[18px] font-semibold"
          >
            重新选图
          </button>
        </div>
      )}

      {!submitting && (
        <>
          <label className="tap-target focus-ring flex cursor-pointer items-center justify-center rounded-2xl border-4 border-dashed border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[20px] font-medium text-[var(--color-fg-muted)]">
            {images.length === 0 ? "点这里选照片（可多选）" : "继续添加照片"}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>

          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {images.map((img) => (
                <div key={img.id} className="relative aspect-square overflow-hidden rounded-xl border-2 border-[var(--color-border)]">
                  {/* 纯本地 blob 预览，用原生 img 即可，不需要 next/image 的远程优化 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.previewUrl} alt="作业照片预览" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(img.id)}
                    aria-label="删除这张照片"
                    className="focus-ring absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-[18px] text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {submitting && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <div
            className="h-14 w-14 animate-spin rounded-full border-4 border-[var(--color-border)] border-t-[var(--color-primary)]"
            aria-hidden
          />
          <p className="text-[20px] font-medium">正在认字，大约 10 秒…</p>
        </div>
      )}

      <div className="mt-auto pt-4">
        <BigButton onClick={submit} disabled={images.length === 0 || submitting}>
          {submitting ? "正在识别…" : "开始识别"}
        </BigButton>
      </div>
    </main>
  );
}

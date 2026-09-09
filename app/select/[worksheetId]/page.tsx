"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BigButton } from "@/components/BigButton";
import { WordChip, type ChipWord } from "@/components/WordChip";
import { CorrectionDialog } from "@/components/CorrectionDialog";
import { saveLastSession } from "@/components/clientStorage";

// PROJECT.md §11 D-20：duplicateOfRequired 由服务端用 lib/core/normalize.ts
// 的权威实现算好直接给我们，前端不做任何文本归一化。
interface RowWordOut extends ChipWord {
  duplicateOfRequired: boolean;
}
interface RowOut {
  char: string;
  pinyin: string;
  rowIndex: number;
  words: RowWordOut[];
}
interface WorksheetPayload {
  worksheetId: number;
  title: string | null;
  required: ChipWord[];
  rows: RowOut[];
  warnings: string[];
}

export default function SelectPage({
  params,
}: {
  params: Promise<{ worksheetId: string }>;
}) {
  const { worksheetId: worksheetIdRaw } = use(params);
  const worksheetId = Number(worksheetIdRaw);
  const router = useRouter();

  const [data, setData] = useState<WorksheetPayload | null | undefined>(undefined); // undefined=加载中，null=拿不到
  const [selectedByRow, setSelectedByRow] = useState<Record<number, number>>({});
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [previewingId, setPreviewingId] = useState<number | null>(null);
  const [degradedId, setDegradedId] = useState<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const [correctionTarget, setCorrectionTarget] = useState<ChipWord | null>(null);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [correctionNotice, setCorrectionNotice] = useState<string | null>(null);

  // PROJECT.md §11 D-19：选词页是识别链路唯一的人工闸口，改成直接用
  // GET /api/worksheet/:id 做单一数据源——不再依赖 sessionStorage，刷新页
  // 面也能自己从服务端重新拉回完整词表（含现算的 pinyinUncertain /
  // duplicateOfRequired）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/worksheet/${worksheetId}`);
        if (cancelled) return;
        if (!res.ok) {
          setData(null);
          return;
        }
        const body = (await res.json()) as WorksheetPayload;
        if (!cancelled) setData(body);
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worksheetId]);

  // 默认每行选中第一个非重复候选，家长一进来就能看到「已经帮你选好了」的
  // 状态，而不是一个逼着家长必须先操作才能继续的空白界面。
  useEffect(() => {
    if (!data) return;
    setSelectedByRow((prev) => {
      const next = { ...prev };
      for (const row of data.rows) {
        if (next[row.rowIndex] !== undefined) continue;
        const firstEligible = row.words.find((w) => !w.duplicateOfRequired);
        if (firstEligible) next[row.rowIndex] = firstEligible.id;
      }
      return next;
    });
  }, [data]);

  const requiredCount = data?.required.length ?? 0;
  const optionalCount = useMemo(
    () => (data ? data.rows.filter((row) => selectedByRow[row.rowIndex] !== undefined).length : 0),
    [data, selectedByRow]
  );
  const totalCount = requiredCount + optionalCount;

  const playPreview = useCallback((wordId: number) => {
    setDegradedId(null);
    setPreviewingId(wordId);
    if (!previewAudioRef.current) previewAudioRef.current = new Audio();
    const audio = previewAudioRef.current;
    // 试听也遵循「先停再放」的纪律，避免连点多个喇叭时叠音。
    audio.pause();
    audio.currentTime = 0;

    (async () => {
      try {
        const res = await fetch(`/api/audio?wordId=${wordId}&repeat=1`);
        if (!res.ok) {
          setPreviewingId(null);
          return;
        }
        if (res.headers.get("X-TTS-Degraded") === "1") setDegradedId(wordId);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audio.src = url;
        audio.onended = () => {
          setPreviewingId(null);
          URL.revokeObjectURL(url);
        };
        await audio.play();
      } catch {
        setPreviewingId(null);
      }
    })();
  }, []);

  const handlePick = useCallback(async () => {
    setPicking(true);
    setPageError(null);
    try {
      const res = await fetch(`/api/worksheet/${worksheetId}/pick`, { method: "POST" });
      if (!res.ok) {
        setPageError("帮你选词的时候出错了，请再试一次");
        return;
      }
      // PROJECT.md §11 D-17：pick 直接带 rowIndex，不用再靠文本/id 反推行归属。
      const body = (await res.json()) as {
        optional: { id: number; text: string; pinyin: string; rowIndex: number; char: string }[];
      };
      setSelectedByRow((prev) => {
        const next = { ...prev };
        for (const w of body.optional) next[w.rowIndex] = w.id;
        return next;
      });
    } catch {
      setPageError("网络好像断开了，请检查网络后重试");
    } finally {
      setPicking(false);
    }
  }, [worksheetId]);

  const submitCorrection = useCallback(
    async (value: string) => {
      if (!correctionTarget) return;
      setCorrectionSubmitting(true);
      try {
        const res = await fetch(`/api/word/${correctionTarget.id}/tts-text`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ttsText: value }),
        });
        if (!res.ok) {
          setPageError("修正没保存成功，请再试一次");
        } else {
          setCorrectionNotice("已更新，请再试听一次");
        }
      } catch {
        setPageError("网络好像断开了，请检查网络后重试");
      } finally {
        setCorrectionSubmitting(false);
        setCorrectionTarget(null);
      }
    },
    [correctionTarget]
  );

  const startDictation = useCallback(async () => {
    if (!data || creating) return;
    setCreating(true);
    setPageError(null);
    try {
      const wordIds = [
        ...data.required.map((w) => w.id),
        ...Object.values(selectedByRow),
      ];
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worksheetId, wordIds }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        setPageError(body?.error?.message ?? "创建听写会话失败了，请再试一次");
        return;
      }
      const body = (await res.json()) as { sessionId: number };
      saveLastSession({ sessionId: body.sessionId, worksheetId, updatedAt: new Date().toISOString() });
      router.push(`/dictation/${body.sessionId}`);
    } catch {
      setPageError("网络好像断开了，请检查网络后重试");
    } finally {
      setCreating(false);
    }
  }, [data, creating, selectedByRow, worksheetId, router]);

  if (data === undefined) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-[20px] text-[var(--color-fg-muted)]">
        正在加载识别结果…
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-body-fluid">找不到这份识别结果了，可能是链接不对或者作业记录已经不在了。</p>
        <Link href="/upload" className="w-full max-w-xs">
          <BigButton>重新上传</BigButton>
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 pb-28">
      <h1 className="text-[clamp(22px,3.4vmin,30px)] font-bold">{data.title ?? "选词"}</h1>

      <div className="sticky top-0 z-10 rounded-2xl border-2 border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4 text-center text-[clamp(20px,3vmin,26px)] font-semibold">
        必听 {requiredCount} ＋ 选听 {optionalCount} ＝ {totalCount} 个
      </div>

      {pageError && (
        <div className="rounded-xl border-2 border-[var(--color-danger)] bg-[var(--color-danger-bg)] p-3 text-body-fluid text-[var(--color-danger)]">
          {pageError}
        </div>
      )}
      {correctionNotice && (
        <div className="rounded-xl border-2 border-[var(--color-success)] bg-[var(--color-success-bg)] p-3 text-body-fluid text-[var(--color-success)]">
          {correctionNotice}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-[20px] font-bold">必听词语（不能取消）</h2>
        <div className="flex flex-wrap gap-4">
          {data.required.map((w) => (
            <WordChip
              key={w.id}
              word={w}
              mode="locked"
              onPreview={() => playPreview(w.id)}
              onCorrect={() => setCorrectionTarget(w)}
              previewing={previewingId === w.id}
              degraded={degradedId === w.id}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[20px] font-bold">生字组词（每行选一个）</h2>
          <button
            type="button"
            onClick={handlePick}
            disabled={picking}
            className="focus-ring tap-target rounded-2xl bg-[var(--color-primary)] px-4 font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
          >
            {picking ? "选词中…" : "✨ 帮我选（每行一个）"}
          </button>
        </div>

        {data.rows.map((row) => {
          const hasEligible = row.words.some((w) => !w.duplicateOfRequired);
          return (
            <div key={row.rowIndex} className="rounded-2xl border-2 border-[var(--color-border)] p-4">
              <div className="mb-3 flex items-baseline gap-3">
                <span className="pinyin text-[14px] text-[var(--color-fg-muted)]">{row.pinyin}</span>
                <span className="text-[22px] font-bold">{row.char}</span>
                <span className="text-[15px] text-[var(--color-fg-muted)]">第 {row.rowIndex + 1} 行</span>
              </div>
              <div className="flex flex-wrap gap-4">
                {row.words.map((w) => (
                  <WordChip
                    key={w.id}
                    word={w}
                    mode="selectable"
                    duplicate={w.duplicateOfRequired}
                    selected={selectedByRow[row.rowIndex] === w.id}
                    onSelect={() => setSelectedByRow((prev) => ({ ...prev, [row.rowIndex]: w.id }))}
                    onPreview={() => playPreview(w.id)}
                    onCorrect={() => setCorrectionTarget(w)}
                    previewing={previewingId === w.id}
                    degraded={degradedId === w.id}
                  />
                ))}
              </div>
              {!hasEligible && (
                <p className="mt-2 text-body-fluid text-[var(--color-fg-muted)]">
                  这一行的组词都已经在必听词里了，不用另外选。
                </p>
              )}
            </div>
          );
        })}
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t-2 border-[var(--color-border)] bg-[var(--color-bg)] p-4">
        <div className="mx-auto max-w-4xl">
          <BigButton onClick={startDictation} disabled={creating}>
            {creating ? "正在准备…" : "开始听写"}
          </BigButton>
        </div>
      </div>

      {correctionTarget && (
        <CorrectionDialog
          wordText={correctionTarget.text}
          defaultValue={correctionTarget.text}
          submitting={correctionSubmitting}
          onCancel={() => setCorrectionTarget(null)}
          onSubmit={submitCorrection}
        />
      )}
    </main>
  );
}

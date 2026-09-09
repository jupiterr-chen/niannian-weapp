"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BigButton } from "@/components/BigButton";
import { LongPressButton } from "@/components/LongPressButton";
import { useWakeLock } from "@/hooks/useWakeLock";
import { clearLastSession } from "@/components/clientStorage";

// 与 GET /api/session/:id（lib/db/queries.ts 的 getSessionFull）返回的 JSON
// 形状对齐；有意在这里本地重声明类型而不是从 lib/db 导入——那个模块依赖
// better-sqlite3/node:sqlite，是纯服务端代码，不应该被拉进客户端 bundle。
interface SessionSettings {
  repeat: number;
  gapMs: number;
  speed: number;
  voice: string;
}
interface SessionInfo {
  id: number;
  worksheetId: number | null;
  createdAt: string;
  settings: SessionSettings;
  cursor: number;
  finishedAt: string | null;
}
interface WordInfo {
  id: number;
  text: string;
  pinyin: string;
  ttsText: string | null;
  isSingle: boolean;
  firstSeen: string;
}
type Bucket = "required" | "optional";
type AttemptStatus = "pending" | "written" | "skipped";
interface AttemptInfo {
  id: number;
  sessionId: number;
  wordId: number;
  seq: number;
  bucket: Bucket;
  status: AttemptStatus;
  replayCount: number;
  hintLevel: number;
  word: WordInfo;
}
interface SessionFull {
  session: SessionInfo;
  attempts: AttemptInfo[];
}

type PlayState = "idle" | "playing" | "waiting";

const REPLAY_DEBOUNCE_MS = 800;
const END_HOLD_MS = 1000;

async function fetchTts(
  wordId: number,
  speed: number,
  repeat: number,
  seq: number
): Promise<{ blob: Blob; degraded: boolean } | "unavailable" | null> {
  const qs = new URLSearchParams({
    wordId: String(wordId),
    speed: String(speed),
    repeat: String(repeat),
    seq: String(seq),
  });
  try {
    const res = await fetch(`/api/audio?${qs.toString()}`);
    if (res.status === 503) return "unavailable";
    if (!res.ok) return null;
    const degraded = res.headers.get("X-TTS-Degraded") === "1";
    const blob = await res.blob();
    return { blob, degraded };
  } catch {
    return null;
  }
}

function prefetchTts(wordId: number, speed: number, repeat: number, seq: number): void {
  const qs = new URLSearchParams({
    wordId: String(wordId),
    speed: String(speed),
    repeat: String(repeat),
    seq: String(seq),
  });
  // 预取只是替浏览器 HTTP 缓存预热，不需要处理结果，也不能让它的失败影响主流程。
  fetch(`/api/audio?${qs.toString()}`).catch(() => {});
}

export default function DictationPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId: sessionIdRaw } = use(params);
  const sessionId = Number(sessionIdRaw);
  const router = useRouter();

  useWakeLock();

  const [full, setFull] = useState<SessionFull | null | undefined>(undefined);
  const [attempts, setAttempts] = useState<AttemptInfo[]>([]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [replaying, setReplaying] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const mainAudioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);
  const lastReplayClickRef = useRef(0);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const cursorIndexRef = useRef(0);
  cursorIndexRef.current = cursorIndex;

  // 当前词绝不上屏——包括 tab 标题；标题固定，不随词变化。
  useEffect(() => {
    document.title = "听写中 · 听写助手";
  }, []);

  useEffect(() => {
    if (!mainAudioRef.current) mainAudioRef.current = new Audio();
  }, []);

  const stopAudio = useCallback(() => {
    const audio = mainAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.pause();
      audio.currentTime = 0;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  // 浏览器 speechSynthesis 兜底（§5.4 降级链最后一环）：GET /api/audio 返回
  // 503 时用它朗读，界面另外标「读音可能不准」。
  const speakFallback = useCallback((text: string, repeat: number, gapMs: number, rate: number, token: number) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    let count = 0;
    const speakOnce = () => {
      if (playTokenRef.current !== token || count >= repeat) return;
      count += 1;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "zh-CN";
      utter.rate = rate;
      utter.onend = () => {
        if (playTokenRef.current !== token) return;
        if (count < repeat) {
          setTimeout(speakOnce, gapMs);
        } else {
          setPlayState("waiting");
        }
      };
      window.speechSynthesis.speak(utter);
    };
    speakOnce();
  }, []);

  // 铁律 1：切词/重播前先 stop 再 play，绝不叠音——playForAttempt 一进来就
  // 调用 stopAudio()。铁律 3 由调用方在切到新词时另外触发 prefetchTts。
  const playForAttempt = useCallback(
    async (attempt: AttemptInfo, opts: { speed: number; repeat: number }) => {
      playTokenRef.current += 1;
      const myToken = playTokenRef.current;
      stopAudio();
      setPlayState("playing");
      setDegraded(false);

      const result = await fetchTts(attempt.wordId, opts.speed, opts.repeat, attempt.seq);
      if (playTokenRef.current !== myToken) return; // 期间又发生了新的播放请求，这次结果作废

      if (result === "unavailable") {
        setDegraded(true);
        const effectiveText = attempt.word.ttsText ?? attempt.word.text;
        speakFallback(effectiveText, opts.repeat, full?.session.settings.gapMs ?? 1500, opts.speed, myToken);
        return;
      }
      if (result === null) {
        setPlayState("waiting");
        return;
      }

      setDegraded(result.degraded);
      const audio = mainAudioRef.current;
      if (!audio) return;
      const url = URL.createObjectURL(result.blob);
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (playTokenRef.current === myToken) setPlayState("waiting");
      };
      try {
        await audio.play();
      } catch {
        if (playTokenRef.current === myToken) setPlayState("waiting");
      }
    },
    [stopAudio, speakFallback, full?.session.settings.gapMs]
  );

  const prefetchNext = useCallback((index: number, speed: number, repeat: number) => {
    const next = attempts[index];
    if (!next) return;
    const key = `${next.wordId}:${speed}:${repeat}:${next.seq}`;
    if (prefetchedRef.current.has(key)) return;
    prefetchedRef.current.add(key);
    prefetchTts(next.wordId, speed, repeat, next.seq);
  }, [attempts]);

  // 加载会话，支持刷新页面后从 cursor 断点续做。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) {
          if (!cancelled) setLoadError("找不到这次听写记录了，请回到首页重新开始。");
          return;
        }
        const body = (await res.json()) as SessionFull;
        if (cancelled) return;
        if (body.session.finishedAt || body.session.cursor >= body.attempts.length) {
          router.replace(`/done/${sessionId}`);
          return;
        }
        setFull(body);
        setAttempts(body.attempts);
        setCursorIndex(body.session.cursor);
      } catch {
        if (!cancelled) setLoadError("网络好像断开了，请检查网络后重试。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  // 铁律 5：切后台再回来，停在原词、不自动播报。只在离开时暂停，回来什么都
  // 不做（不会自动续播）。
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        stopAudio();
        setPlayState((s) => (s === "playing" ? "waiting" : s));
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [stopAudio]);

  useEffect(() => {
    return () => stopAudio();
  }, [stopAudio]);

  const patchAttempt = useCallback(
    (attemptId: number, seq: number, patch: { status?: AttemptStatus; hintLevel?: number }) => {
      fetch(`/api/attempt/${attemptId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, sessionId, seq }),
      }).catch(() => {
        // 静默失败：本地状态已经乐观更新，断点续做时以服务端 cursor 为准，
        // 单次网络抖动不应该打断孩子正在进行的听写。
      });
    },
    [sessionId]
  );

  // 铁律 4：进入页面不自动播放，必须由一次明确点击解锁音频（iOS Safari 要求）。
  const handleUnlock = useCallback(() => {
    setUnlocked(true);
    const attempt = attempts[cursorIndex];
    if (!attempt || !full) return;
    void playForAttempt(attempt, { speed: full.session.settings.speed, repeat: full.session.settings.repeat });
    prefetchNext(cursorIndex + 1, full.session.settings.speed, full.session.settings.repeat);
  }, [attempts, cursorIndex, full, playForAttempt, prefetchNext]);

  const advance = useCallback(
    (status: AttemptStatus) => {
      const attempt = attempts[cursorIndex];
      if (!attempt || !full) return;

      setAttempts((prev) => prev.map((a) => (a.id === attempt.id ? { ...a, status } : a)));
      patchAttempt(attempt.id, attempt.seq, { status });

      const nextIndex = cursorIndex + 1;
      if (nextIndex >= attempts.length) {
        stopAudio();
        clearLastSession();
        router.push(`/done/${sessionId}`);
        return;
      }
      setCursorIndex(nextIndex);
      void playForAttempt(attempts[nextIndex], {
        speed: full.session.settings.speed,
        repeat: full.session.settings.repeat,
      });
      prefetchNext(nextIndex + 1, full.session.settings.speed, full.session.settings.repeat);
    },
    [attempts, cursorIndex, full, patchAttempt, playForAttempt, prefetchNext, router, sessionId, stopAudio]
  );

  // 铁律 2 + 7：800ms 内重复点击忽略、正在加载时忽略；慢速单遍；hintLevel +1（上限 3）。
  const onReplay = useCallback(() => {
    const now = Date.now();
    if (now - lastReplayClickRef.current < REPLAY_DEBOUNCE_MS) return;
    if (replaying) return;
    lastReplayClickRef.current = now;

    const attempt = attempts[cursorIndex];
    if (!attempt || !full) return;

    setReplaying(true);
    const newHintLevel = Math.min(3, attempt.hintLevel + 1);
    setAttempts((prev) => prev.map((a) => (a.id === attempt.id ? { ...a, hintLevel: newHintLevel } : a)));
    patchAttempt(attempt.id, attempt.seq, { hintLevel: newHintLevel });

    void playForAttempt(attempt, { speed: 0.8, repeat: 1 }).finally(() => setReplaying(false));
  }, [attempts, cursorIndex, full, patchAttempt, playForAttempt, replaying]);

  const handleEnd = useCallback(() => {
    stopAudio();
    clearLastSession();
    router.push(`/done/${sessionId}`);
  }, [router, sessionId, stopAudio]);

  if (loadError) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-[20px]">{loadError}</p>
        <BigButton onClick={() => router.push("/")}>回到首页</BigButton>
      </main>
    );
  }

  if (full === undefined || attempts.length === 0) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-[20px] text-[var(--color-fg-muted)]">
        正在加载听写会话…
      </main>
    );
  }

  const currentAttempt = attempts[cursorIndex];
  const total = attempts.length;
  const progressPct = Math.round((currentAttempt.seq / total) * 100);
  const statusText =
    playState === "playing" ? (replaying ? "🔊 正在朗读（慢速再读一遍）" : "🔊 正在朗读") : "✍️ 轮到你写啦";

  return (
    <main className="relative flex flex-1 flex-col items-center justify-between gap-8 px-6 py-10">
      {!unlocked && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-[var(--color-bg)] p-6 text-center">
          <p className="text-[22px]">准备好了就点一下，开始听写</p>
          <button
            type="button"
            onClick={handleUnlock}
            className="tap-target focus-ring flex w-full max-w-xs items-center justify-center rounded-3xl bg-[var(--color-primary)] px-8 text-[26px] font-bold text-[var(--color-primary-fg)]"
          >
            ▶ 开始听写
          </button>
        </div>
      )}

      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <div className="seq-number text-[72px] font-bold leading-none">
          第 {currentAttempt.seq} / {total} 个
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-chip-bg)]">
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <p className="text-[20px] text-[var(--color-fg-muted)]">{statusText}</p>
        {degraded && <p className="text-[15px] text-[var(--color-fg-muted)]">读音可能不准</p>}
        {currentAttempt.hintLevel >= 3 && (
          <p className="pinyin mt-2 text-[24px] text-[var(--color-warning)]">{currentAttempt.word.pinyin}</p>
        )}
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        <button
          type="button"
          onClick={onReplay}
          disabled={!unlocked}
          className="tap-target focus-ring w-full rounded-3xl bg-[var(--color-primary)] text-[28px] font-bold text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          再 读 一 遍
        </button>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => advance("skipped")}
            disabled={!unlocked}
            className="tap-target focus-ring flex-1 rounded-3xl border-2 border-[var(--color-border)] text-[22px] font-semibold disabled:opacity-50"
          >
            不会，跳过
          </button>
          <button
            type="button"
            onClick={() => advance("written")}
            disabled={!unlocked}
            className="tap-target focus-ring flex-1 rounded-3xl bg-[var(--color-success)] text-[22px] font-semibold text-[var(--color-success-fg)] disabled:opacity-50"
          >
            写好了，下一个
          </button>
        </div>
      </div>

      <LongPressButton label="结束听写" durationMs={END_HOLD_MS} onComplete={handleEnd} />
    </main>
  );
}

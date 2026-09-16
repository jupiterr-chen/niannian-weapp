// 听写页（对应 Web 版 app/dictation/[sessionId]/page.tsx）。
// PROJECT.md §9 交互铁律的移植落点：
//   1. 先 stop 再 play、绝不叠音 → utils/audio.js 的令牌 + 销毁旧 context；
//   2. 「再读一遍」800ms 去抖、不排队；
//   3. 进入第 i 词时预取第 i+1 词（downloadFile 提前拉 WAV）；
//   4. 首次进入必须一次明确点击解锁，不自动播第一个词；
//   5. 切后台/来电中断：只停不续，回来停在原词；
//   6. 三遍读完停在等待作答，不自动跳词；
//   7. 「再读一遍」慢速单遍（speed=0.8, repeat=1），hint_level +1（上限 3）。
// 与 Web 版的差异：小程序没有浏览器 SpeechSynthesis，服务端 503 时不再有
// 最后一环兜底，改为提示点「再读一遍」重试。
const { request } = require("../../utils/request");
const audio = require("../../utils/audio");
const storage = require("../../utils/storage");
const config = require("../../config");

const REPLAY_DEBOUNCE_MS = 800;

// 2026-09-12 反馈调整：不再报「第 N 个」直接读词；三遍重复的间隔由 1.5s
// 拉长到 2.5s（服务端按 gapMs 重新拼装，词级音频缓存不受影响）。
const DICTATION_GAP_MS = 2500;

function audioPath(wordId, speed, repeat) {
  return `/api/audio?wordId=${wordId}&speed=${speed}&repeat=${repeat}&gapMs=${DICTATION_GAP_MS}`;
}

Page({
  data: {
    state: "loading", // loading | error | ready
    loadError: null,
    sessionId: 0,
    settings: { repeat: 3, gapMs: 1500, speed: 1.0, voice: "" },
    attempts: [],
    total: 0,
    cursorIndex: 0,
    current: null,
    progressPct: 0,
    remainingCount: 0,
    statusText: "",
    unlocked: false,
    playState: "idle", // idle | playing | waiting
    replaying: false,
    degraded: false,
    ttsError: false,
    endOpen: false,
    elapsedText: "00:00",
  },

  onLoad(options) {
    this.elapsedSec = null;
    this.timerId = null;
    // 当前词绝不上屏——导航栏标题固定，不随词变化。
    wx.setNavigationBarTitle({ title: "听写中 · 听写助手" });
    wx.setKeepScreenOn({ keepScreenOn: true });

    this.setData({ sessionId: Number(options.id) });
    this.lastReplayClick = 0;
    // 铁律 5 的中断分支：来电/其他 App 抢占音频时立即停，回来不自动续播。
    this.interruptionHandler = () => this.pauseForBackground();
    wx.onAudioInterruptionBegin(this.interruptionHandler);

    this.load();
  },

  onUnload() {
    if (this.interruptionHandler) wx.offAudioInterruptionBegin(this.interruptionHandler);
    audio.main.stop();
    this.stopTimer();
    wx.setKeepScreenOn({ keepScreenOn: false });
  },

  // --- 计时：从首次解锁起算，断点续做从本地累计值接着走 ---
  startTimer() {
    if (this.timerId) return;
    if (this.elapsedSec == null) this.elapsedSec = storage.getElapsed(this.data.sessionId);
    this.setData({ elapsedText: storage.formatElapsed(this.elapsedSec) });
    this.timerId = setInterval(() => {
      this.elapsedSec += 1;
      if (this.elapsedSec % 5 === 0) storage.setElapsed(this.data.sessionId, this.elapsedSec);
      this.setData({ elapsedText: storage.formatElapsed(this.elapsedSec) });
    }, 1000);
  },

  stopTimer() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.elapsedSec != null) {
      storage.setElapsed(this.data.sessionId, this.elapsedSec);
      return this.elapsedSec * 1000;
    }
    return 0;
  },

  // 铁律 5：切后台只停不续。
  onHide() {
    this.pauseForBackground();
  },

  pauseForBackground() {
    audio.main.stop();
    if (this.data.playState === "playing") {
      this.setData({ playState: "waiting", replaying: false });
      this.refreshStatus();
    }
  },

  async load() {
    try {
      const body = await request(`/api/session/${this.data.sessionId}`);
      if (body.session.finishedAt || body.session.cursor >= body.attempts.length) {
        wx.redirectTo({ url: `/pages/done/done?id=${this.data.sessionId}` });
        return;
      }
      this.applySession(body);
    } catch (err) {
      this.setData({ state: "error", loadError: "找不到这次听写记录了，请回到首页重新开始。" });
    }
  },

  applySession(body) {
    this.setData({
      state: "ready",
      settings: body.session.settings,
      attempts: body.attempts,
      total: body.attempts.length,
      cursorIndex: body.session.cursor,
    });
    this.refreshCurrent();
    // 开发截图辅助：跳过解锁遮罩直接进入主界面（本地配置才会开启）。
    if (config.devAutoUnlock && !this.data.unlocked) {
      setTimeout(() => {
        if (!this.data.unlocked) this.handleUnlock();
      }, 500);
    }
  },

  refreshCurrent() {
    const attempt = this.data.attempts[this.data.cursorIndex];
    this.setData({
      current: attempt,
      progressPct: Math.round((attempt.seq / this.data.total) * 100),
      remainingCount: this.data.total - this.data.cursorIndex,
    });
    this.refreshStatus();
  },

  refreshStatus() {
    const { playState, replaying } = this.data;
    const text =
      playState === "playing" ? (replaying ? "慢慢听" : "认真听") : "轮到你写啦";
    this.setData({ statusText: text, statusLong: text.length > 6 });
  },

  // 播放当前词。playState 由引擎回调驱动；任何新的播放/停止都会作废旧回调。
  playForAttempt(attempt, opts) {
    this.setData({ playState: "playing", degraded: false, ttsError: false });
    this.refreshStatus();
    audio.main
      .play(audioPath(attempt.wordId, opts.speed, opts.repeat), {
        onEnded: () => this.setData({ playState: "waiting", replaying: false }),
        onError: () => this.setData({ playState: "waiting", replaying: false }),
      })
      .then((res) => {
        if (res && res.degraded) this.setData({ degraded: true });
      })
      .catch((err) => {
        // 服务端 503（tts_unavailable）或下载失败：回到等待，提示重试。
        if (err && err.unavailable) this.setData({ ttsError: true });
        this.setData({ playState: "waiting", replaying: false });
        this.refreshStatus();
      })
      .then(() => this.refreshStatus());
  },

  prefetchNext() {
    const next = this.data.attempts[this.data.cursorIndex + 1];
    if (!next) return;
    const { speed, repeat } = this.data.settings;
    audio.prefetch(audioPath(next.wordId, speed, repeat));
  },

  handleUnlock() {
    this.setData({ unlocked: true });
    this.startTimer();
    const { speed, repeat } = this.data.settings;
    this.playForAttempt(this.data.attempts[this.data.cursorIndex], { speed, repeat });
    this.prefetchNext();
  },

  // 乐观更新本地状态；PATCH 静默失败——断点续做以服务端 cursor 为准。
  patchAttempt(attemptId, patch) {
    request(`/api/attempt/${attemptId}`, { method: "PATCH", data: patch }).catch(() => {});
  },

  advance(status) {
    const index = this.data.cursorIndex;
    const attempt = this.data.attempts[index];
    if (!attempt) return;

    const attempts = this.data.attempts.map((a) => (a.id === attempt.id ? { ...a, status } : a));
    this.setData({ attempts });
    this.patchAttempt(attempt.id, { status });

    const nextIndex = index + 1;
    if (nextIndex >= this.data.total) {
      audio.main.stop();
      const ms = this.stopTimer();
      storage.clearLastSession();
      wx.redirectTo({ url: `/pages/done/done?id=${this.data.sessionId}&ms=${ms}` });
      return;
    }
    const { speed, repeat } = this.data.settings;
    this.setData({ cursorIndex: nextIndex, replaying: false });
    this.refreshCurrent();
    this.playForAttempt(attempts[nextIndex], { speed, repeat });
    this.prefetchNext();
  },

  advanceWritten() {
    this.advance("written");
  },

  advanceSkip() {
    this.advance("skipped");
  },

  // 铁律 2 + 7：800ms 内重复点击忽略、正在重播时忽略；慢速单遍 + hint +1。
  onReplay() {
    const now = Date.now();
    if (now - this.lastReplayClick < REPLAY_DEBOUNCE_MS) return;
    if (this.data.replaying) return;
    this.lastReplayClick = now;

    const index = this.data.cursorIndex;
    const attempt = this.data.attempts[index];
    if (!attempt) return;

    const newHintLevel = Math.min(3, attempt.hintLevel + 1);
    this.setData({
      attempts: this.data.attempts.map((a) =>
        a.id === attempt.id ? { ...a, hintLevel: newHintLevel } : a
      ),
      current: { ...attempt, hintLevel: newHintLevel },
      replaying: true,
    });
    this.patchAttempt(attempt.id, { hintLevel: newHintLevel });

    this.playForAttempt(attempt, { speed: 0.8, repeat: 1 });
  },

  openEnd() {
    this.setData({ endOpen: true });
  },

  closeEnd() {
    this.setData({ endOpen: false });
  },

  confirmEnd() {
    this.setData({ endOpen: false });
    audio.main.stop();
    const ms = this.stopTimer();
    storage.clearLastSession();
    wx.redirectTo({ url: `/pages/done/done?id=${this.data.sessionId}&ms=${ms}` });
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  noop() {},
});

// 选词页（对应 Web 版 app/select/[worksheetId]/page.tsx）。
// 数据源是 GET /api/worksheet/:id（D-19）：pinyinUncertain 与
// duplicateOfRequired 都由服务端算好（D-20/D-22），前端不做任何文本归一化。
const { request, NETWORK_ERROR } = require("../../utils/request");
const audio = require("../../utils/audio");
const storage = require("../../utils/storage");

Page({
  data: {
    state: "loading", // loading | ready | missing
    worksheetId: 0,
    title: "",
    required: [],
    rows: [],
    requiredCount: 0,
    optionalCount: 0,
    totalCount: 0,
    selected: {}, // rowIndex -> wordId（默认每行选第一个非重复候选）
    picking: false,
    creating: false,
    pageError: null,
    correctionNotice: null,
    previewingId: null,
    degradedId: null,
    correction: null, // { wordId, word, value, canSubmit }
    correctionSubmitting: false,
  },

  onLoad(options) {
    this.setData({ worksheetId: Number(options.id) });
    this.load();
  },

  onUnload() {
    audio.preview.stop();
  },

  async load() {
    try {
      const body = await request(`/api/worksheet/${this.data.worksheetId}`);
      this.applyWorksheet(body);
    } catch (err) {
      // 404 与网络错误在这里都归为「拿不到」，与 Web 版行为一致。
      this.setData({ state: err.status === 404 ? "missing" : "error", pageError: err.message });
    }
  },

  applyWorksheet(body) {
    const selected = {};
    for (const row of body.rows) {
      const firstEligible = row.words.find((w) => !w.duplicateOfRequired);
      if (firstEligible) selected[row.rowIndex] = firstEligible.id;
    }
    this.setData({ state: "ready", pageError: null, ...this.buildView(body, selected) });
  },

  // 把 selected 映射进 rows 的 selected 标记并算好汇总数。
  buildView(body, selected) {
    const rows = body.rows.map((row) => ({
      ...row,
      hasEligible: row.words.some((w) => !w.duplicateOfRequired),
      words: row.words.map((w) => ({ ...w, selected: selected[row.rowIndex] === w.id })),
    }));
    const optionalCount = body.rows.filter((row) => selected[row.rowIndex] !== undefined).length;
    return {
      title: body.title || "选词",
      required: body.required,
      rows,
      selected,
      requiredCount: body.required.length,
      optionalCount,
      totalCount: body.required.length + optionalCount,
    };
  },

  selectWord(e) {
    const { row, id, dup } = e.currentTarget.dataset;
    // dataset 的布尔值在个别基础库版本会串化成字符串，两种形态都挡掉。
    if (dup === true || dup === "true") return;
    const selected = { ...this.data.selected, [row]: id };
    this.setData(this.buildView({ ...this.data, rows: this.data.rows }, selected));
  },

  goUpload() {
    wx.redirectTo({ url: "/pages/upload/upload" });
  },

  previewWord(e) {
    const wordId = Number(e.currentTarget.dataset.id);
    // 试听也遵守「先停再放」的纪律，避免连点多个喇叭时叠音。
    this.setData({ previewingId: wordId, degradedId: null });
    audio.preview
      .play(`/api/audio?wordId=${wordId}&repeat=1`, {
        onEnded: () => this.setData({ previewingId: null }),
        onError: () => this.setData({ previewingId: null }),
      })
      .then((res) => {
        if (res && res.degraded) this.setData({ degradedId: wordId });
      })
      .catch(() => this.setData({ previewingId: null }));
  },

  async handlePick() {
    if (this.data.picking) return;
    this.setData({ picking: true, pageError: null });
    try {
      const body = await request(`/api/worksheet/${this.data.worksheetId}/pick`, { method: "POST" });
      // D-17：pick 直接带 rowIndex，不用靠文本/id 反推行归属。
      const selected = { ...this.data.selected };
      for (const w of body.optional) selected[w.rowIndex] = w.id;
      this.setData(this.buildView({ ...this.data, rows: this.data.rows }, selected));
    } catch (err) {
      this.setData({ pageError: err.message === NETWORK_ERROR ? "网络好像断开了，请检查网络重试" : "帮你选词的时候出错了，请再试一次" });
    } finally {
      this.setData({ picking: false });
    }
  },

  correctWord(e) {
    const wordId = Number(e.currentTarget.dataset.id);
    const word = e.currentTarget.dataset.word;
    this.setData({
      correction: { wordId, word, value: word, canSubmit: true },
      correctionSubmitting: false,
    });
  },

  onCorrectionInput(e) {
    const value = e.detail.value;
    this.setData({ correction: { ...this.data.correction, value, canSubmit: value.trim().length > 0 } });
  },

  cancelCorrection() {
    this.setData({ correction: null });
  },

  noop() {},

  async submitCorrection() {
    const c = this.data.correction;
    if (!c || !c.canSubmit || this.data.correctionSubmitting) return;
    this.setData({ correctionSubmitting: true });
    try {
      await request(`/api/word/${c.wordId}/tts-text`, {
        method: "PATCH",
        data: { ttsText: c.value.trim() },
      });
      this.setData({ correction: null, correctionNotice: "已更新，请再试听一次" });
    } catch (err) {
      this.setData({ correction: null, pageError: err.message });
    } finally {
      this.setData({ correctionSubmitting: false });
    }
  },

  async startDictation() {
    if (this.data.state !== "ready" || this.data.creating) return;
    this.setData({ creating: true, pageError: null });
    try {
      const wordIds = this.data.required.map((w) => w.id).concat(Object.values(this.data.selected));
      const body = await request("/api/session", {
        method: "POST",
        data: { worksheetId: this.data.worksheetId, wordIds },
      });
      storage.saveLastSession({
        sessionId: body.sessionId,
        worksheetId: this.data.worksheetId,
        updatedAt: new Date().toISOString(),
      });
      wx.redirectTo({ url: `/pages/dictation/dictation?id=${body.sessionId}` });
    } catch (err) {
      this.setData({ pageError: err.message, creating: false });
    }
  },
});

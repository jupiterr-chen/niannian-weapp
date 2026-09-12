// 历史记录页（对应 Web 版 app/history/page.tsx）。
// 点开记录只读 GET /api/session/:id，绝不触发 finish（那是幂等的，但没必要调）。
const { request } = require("../../utils/request");

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    state: "loading", // loading | ready | error
    history: [],
    openSessionId: null,
    details: {}, // sessionId -> attempts[]
  },

  onLoad() {
    this.load();
  },

  async load() {
    try {
      const body = await request("/api/history");
      this.setData({
        state: "ready",
        history: body.history.map((row) => ({ ...row, dateText: formatDate(row.createdAt) })),
      });
    } catch (err) {
      this.setData({ state: "error" });
    }
  },

  async toggleOpen(e) {
    const sessionId = Number(e.currentTarget.dataset.sessionId);
    if (this.data.openSessionId === sessionId) {
      this.setData({ openSessionId: null });
      return;
    }
    this.setData({ openSessionId: sessionId });
    if (this.data.details[sessionId]) return;
    try {
      const body = await request(`/api/session/${sessionId}`);
      this.setData({ details: { ...this.data.details, [sessionId]: body.attempts } });
    } catch (err) {
      // 展开失败保持「加载词表中…」，再点一次会重试。
    }
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});

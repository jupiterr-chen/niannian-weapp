// 完成页（对应 Web 版 app/done/[sessionId]/page.tsx）。
// finishSession 后端已幂等（D-18）。庆祝卡片按表现给称号：
//   全对无提示 → 🏆 听写大满贯；跳过 ≤2 → 🌟 听写小达人；否则 💪 完成听写。
const { request } = require("../../utils/request");
const storage = require("../../utils/storage");

Page({
  data: {
    result: null,
    error: null,
    badge: "",
    title: "",
    durationText: "",
  },

  onLoad(options) {
    this.requested = false;
    this.sessionId = Number(options.id);
    // 听写页跳转带来的本次用时（ms）；直接刷新本页时没有，退回服务端存的值。
    this.finalMs = Number(options.ms) || 0;
    this.fetch();
  },

  async fetch() {
    if (this.requested) return;
    this.requested = true;
    try {
      const body = await request(`/api/session/${this.sessionId}/finish`, {
        method: "POST",
        data: this.finalMs > 0 ? { durationMs: this.finalMs } : {},
      });
      storage.clearLastSession();
      storage.clearElapsed(this.sessionId);

      const { badge, title } = this.rankOf(body);
      const ms = this.finalMs || body.durationMs || 0;
      this.setData({
        result: body,
        badge,
        title,
        durationText: ms > 0 ? storage.formatElapsed(ms / 1000) : "",
      });
    } catch (err) {
      this.setData({ error: "统计结果没拿到，不过听写已经做完啦。" });
    }
  },

  rankOf(result) {
    if (result.skipped === 0 && result.hintCount === 0) {
      return { badge: "🏆", title: "听写大满贯！" };
    }
    if (result.skipped <= 2) {
      return { badge: "🌟", title: "听写小达人！" };
    }
    return { badge: "💪", title: "完成听写！" };
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});

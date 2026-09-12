// 完成页（对应 Web 版 app/done/[sessionId]/page.tsx）。
// finishSession 后端已幂等（D-18），重复调用只会读统计、不会重复累加 mistakes。
const { request } = require("../../utils/request");
const storage = require("../../utils/storage");

Page({
  data: {
    result: null,
    error: null,
  },

  onLoad(options) {
    this.requested = false;
    this.sessionId = Number(options.id);
    this.fetch();
  },

  async fetch() {
    if (this.requested) return;
    this.requested = true;
    try {
      const body = await request(`/api/session/${this.sessionId}/finish`, { method: "POST" });
      this.setData({ result: body });
    } catch (err) {
      this.setData({ error: "统计结果没拿到，不过听写已经做完啦。" });
    } finally {
      storage.clearLastSession();
    }
  },

  goHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});

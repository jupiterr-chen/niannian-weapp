// 首页（对应 Web 版 app/page.tsx）：上传入口 + 继续上次 + 历史。
// 「继续上次」只在本地确实记着未结束会话时出现，避免点了就报错。
const storage = require("../../utils/storage");

Page({
  data: {
    lastSessionId: null,
  },

  onShow() {
    this.setData({ lastSessionId: (storage.readLastSession() || {}).sessionId ?? null });
  },

  goUpload() {
    wx.navigateTo({ url: "/pages/upload/upload" });
  },

  continueLast() {
    const record = storage.readLastSession();
    if (!record) return;
    wx.navigateTo({ url: `/pages/dictation/dictation?id=${record.sessionId}` });
  },

  goHistory() {
    wx.navigateTo({ url: "/pages/history/history" });
  },

  goPrivacy() {
    wx.navigateTo({ url: "/pages/privacy/privacy" });
  },
});

// 「继续上次听写」的本地记录，对应 Web 版 clientStorage.ts 的 localStorage。
// 开始听写时写入，/done 页完成后清除。
const KEY = "niannian:lastSession";

function saveLastSession(record) {
  try {
    wx.setStorageSync(KEY, record);
  } catch (e) {
    // 存储不可用时静默忽略，不影响主流程。
  }
}

function readLastSession() {
  try {
    const raw = wx.getStorageSync(KEY);
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.sessionId !== "number") return null;
    return raw;
  } catch (e) {
    return null;
  }
}

function clearLastSession() {
  try {
    wx.removeStorageSync(KEY);
  } catch (e) {
    // 忽略。
  }
}

module.exports = { saveLastSession, readLastSession, clearLastSession };

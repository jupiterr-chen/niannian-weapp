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

// 听写计时：断点续做/中途退出后，已进行的秒数 keyed by sessionId 持久化。
function elapsedKey(sessionId) {
  return `niannian:elapsed:${sessionId}`;
}

function getElapsed(sessionId) {
  try {
    return Number(wx.getStorageSync(elapsedKey(sessionId))) || 0;
  } catch (e) {
    return 0;
  }
}

function setElapsed(sessionId, seconds) {
  try {
    wx.setStorageSync(elapsedKey(sessionId), seconds);
  } catch (e) {
    // 忽略：计时只是统计，丢一次无妨。
  }
}

function clearElapsed(sessionId) {
  try {
    wx.removeStorageSync(elapsedKey(sessionId));
  } catch (e) {
    // 忽略。
  }
}

function formatElapsed(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}`;
}

module.exports = {
  saveLastSession,
  readLastSession,
  clearLastSession,
  getElapsed,
  setElapsed,
  clearElapsed,
  formatElapsed,
};

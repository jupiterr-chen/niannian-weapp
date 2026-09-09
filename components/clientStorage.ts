// 纯前端小状态的 key 常量，集中一处避免各页面里的字符串拼错。
// 不属于 lib/（后端契约层），只是浏览器 localStorage/sessionStorage 的约定。

// localStorage：记录「最近一次开始但可能还没做完」的听写会话，用于首页
// 「继续上次」入口。开始听写时写入，/done 页完成后清除。
export const LAST_SESSION_KEY = "renee:lastSession";

// PROJECT.md §11 D-19 已经补了 GET /api/worksheet/:id，选词页改成直接用它
// 做单一数据源（刷新页面也能自行恢复），不再需要 sessionStorage 中转
// /upload 的识别结果——之前那份 worksheetStorageKey 已删除。

export interface LastSessionRecord {
  sessionId: number;
  worksheetId: number;
  updatedAt: string;
}

export function saveLastSession(record: LastSessionRecord): void {
  try {
    window.localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(record));
  } catch {
    // localStorage 不可用（隐私模式等）时静默忽略，不影响主流程。
  }
}

export function clearLastSession(): void {
  try {
    window.localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // 忽略。
  }
}

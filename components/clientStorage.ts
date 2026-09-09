// 纯前端小状态的 key 常量，集中一处避免各页面里的字符串拼错。
// 不属于 lib/（后端契约层），只是浏览器 localStorage/sessionStorage 的约定。

// localStorage：记录「最近一次开始但可能还没做完」的听写会话，用于首页
// 「继续上次」入口。开始听写时写入，/done 页完成后清除。
export const LAST_SESSION_KEY = "renee:lastSession";

// sessionStorage：POST /api/worksheet 的完整识别结果，用于把数据从
// /upload 传给 /select/[worksheetId]——PROJECT.md §7 没有定义
// GET /api/worksheet/:id，选词页只能在同一个标签页内、经由这份本地暂存
// 拿到识别结果（详见任务报告里的契约缺口说明）。
export function worksheetStorageKey(worksheetId: number | string): string {
  return `renee:worksheet:${worksheetId}`;
}

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

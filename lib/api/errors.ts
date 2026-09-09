// 统一错误信封与包装器。§7：错误一律返回 { error: { code, message } } + 合适的
// HTTP 状态码，message 是可直接展示给家长的中文。任何路由都不允许把原始异常
// 栈泄漏给前端——未预期异常一律被 handler() 拦下，只把 console.error 打到
// 服务端日志。
import { NextResponse } from "next/server";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ErrorPayload {
  error: { code: string; message: string };
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function fail(err: ApiError): NextResponse<ErrorPayload> {
  return NextResponse.json(
    { error: { code: err.code, message: err.message } },
    { status: err.status }
  );
}

const FALLBACK_MESSAGE = "服务器出错了，请稍后再试。";

// Next.js route handler 签名是 (request, ctx?) => Response | Promise<Response>；
// 用可变参数保留这一形状，这样同一个 handler() 既能包动态路由（第二个参数是
// { params: Promise<...> }）也能包无参数的路由。
type RouteHandler<Args extends unknown[]> = (
  request: Request,
  ...args: Args
) => Promise<Response>;

export function handler<Args extends unknown[] = []>(
  fn: RouteHandler<Args>
): RouteHandler<Args> {
  return async (request, ...args) => {
    try {
      return await fn(request, ...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err);
      }
      // 原始异常只落服务端日志，绝不透给前端。
      console.error("[api] 未预期异常:", err);
      return NextResponse.json(
        { error: { code: "internal_error", message: FALLBACK_MESSAGE } },
        { status: 500 }
      );
    }
  };
}

// 所有 :id 都必须是正整数，非法输入统一走这里报中文 400。
export function parsePositiveIntId(raw: string, label = "id"): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError("invalid_id", 400, `${label} 必须是正整数`);
  }
  return n;
}

// wx.request 的 Promise 封装。后端错误信封是 { error: { code, message } }，
// message 是可直接展示给家长的中文（与 Web 版同一套约定），统一在这里抛出。
const config = require("../config");

const NETWORK_ERROR = "网络好像断开了，请检查网络后重试";

function request(path, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.baseUrl + path,
      method: opts.method || "GET",
      data: opts.data,
      // GET 的 data 会自动拼成 query string；POST JSON 必须显式声明头部。
      header: opts.method === "POST" || opts.method === "PATCH" ? { "Content-Type": "application/json" } : {},
      timeout: opts.timeout || 20000,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        const body = res.data;
        if (body && typeof body === "object" && body.error && typeof body.error.message === "string") {
          const err = new Error(body.error.message);
          err.code = body.error.code;
          err.status = res.statusCode;
          // 识别失败信封会额外带 worksheetId（数据已落库，不能丢），原样透出。
          if (typeof body.worksheetId === "number") err.worksheetId = body.worksheetId;
          reject(err);
          return;
        }
        reject(new Error("服务器出错了，请稍后再试。"));
      },
      fail() {
        reject(new Error(NETWORK_ERROR));
      },
    });
  });
}

module.exports = { request, NETWORK_ERROR };

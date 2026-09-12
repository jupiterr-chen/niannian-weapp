// 服务器地址配置。真实内网地址写在 config.local.js（已被 .gitignore 忽略，
// 不会进公开仓库）；模板见 config.local.example.js。
// 体验版真机使用前必须在手机上打开「开发调试」，否则非备案域名的请求会被拦。
let local = {};
try {
  local = require("./config.local.js");
} catch (e) {
  // 没有 config.local.js 时退回本机开发默认值。
}

module.exports = {
  baseUrl: local.baseUrl || "http://127.0.0.1:3000",
};

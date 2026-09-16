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
  // 开发截图辅助（只在 config.local.js 里出现，见 config.local.example.js）：
  // devStartPage: 启动后自动跳转的页面（含参数），如 "/pages/select/select?id=8"
  // devAutoUnlock: 听写页加载后自动点开始（跳过解锁遮罩），用于截主界面
  devStartPage: local.devStartPage || null,
  devAutoUnlock: !!local.devAutoUnlock,
  // 测试模式：上传页跳过真实上传与 VLM 识别，直接复用最近一次作业的词表
  // （省 token）。只应出现在 config.local.js，线上不会配置。
  devFakeUpload: !!local.devFakeUpload,
};

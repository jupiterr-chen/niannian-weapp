// 复制本文件为 config.local.js，把地址改成你家服务器的局域网地址。
// config.local.js 已被 .gitignore 忽略，真实地址不会进公开仓库。
//
// 开发截图辅助（可选）：
//   devStartPage: 填一个页面路径，启动后自动跳过去，方便截图评审，如
//                 "/pages/select/select?id=8"；不填则正常从首页进入。
//   devAutoUnlock: true 时听写页自动点「开始听写」，跳过解锁遮罩截图用。
module.exports = {
  baseUrl: "http://192.168.1.x:3000",
  devStartPage: null,
  devAutoUnlock: false,
};


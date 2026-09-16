// 复制本文件为 config.local.js，把地址改成你家服务器的局域网地址。
// config.local.js 已被 .gitignore 忽略，真实地址不会进公开仓库。
//
// 开发截图辅助（可选）：
//   devStartPage: 填一个页面路径，启动后自动跳过去，方便截图评审，如
//                 "/pages/select/select?id=8"；不填则正常从首页进入。
//   devAutoUnlock: true 时听写页自动点「开始听写」，跳过解锁遮罩截图用。
//   devFakeUpload: true 时上传页进入测试模式——点「开始识别」不发照片、
//                 不调方舟识别，直接复用最近一次作业的词表进选词页（省 token）。
module.exports = {
  baseUrl: "http://192.168.1.x:3000",
  devStartPage: null,
  devAutoUnlock: false,
};


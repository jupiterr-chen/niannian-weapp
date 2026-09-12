// 听写助手小程序。业务后端是家里 NAS 上的听写服务（同 Web 版），见 config.js。
const audio = require("./utils/audio");
const config = require("./config");

App({
  onLaunch() {
    // 铁律级的设置：iOS 拨到静音键时也必须出声，否则听写在教室外等于哑巴。
    audio.init();
    // 开发截图辅助：本地配置里指定了起始页就直接跳过去（线上不会配置）。
    if (config.devStartPage) {
      setTimeout(() => wx.reLaunch({ url: config.devStartPage }), 300);
    }
  },
});

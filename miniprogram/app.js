// 听写助手小程序。业务后端是家里 NAS 上的听写服务（同 Web 版），见 config.js。
const audio = require("./utils/audio");

App({
  onLaunch() {
    // 铁律级的设置：iOS 拨到静音键时也必须出声，否则听写在教室外等于哑巴。
    audio.init();
  },
});

// 听写音频引擎，移植 PROJECT.md §9 的交互铁律：
//   1. 切词/重播先 stop 再 play，绝不叠音 —— 用「销毁旧 context + 递增令牌」实现，
//      迟到的回调一律作废；
//   2. 预取第 i+1 词 —— wx.downloadFile 提前拉到临时文件，正式播放直接用本地路径；
//   3. 降级标记 —— GET /api/audio 的 X-TTS-Degraded 响应头只能在 downloadFile
//      里读到，所以播放永远走 downloadFile（预取只是提前把同一次下载做完）。
// 小程序没有浏览器 SpeechSynthesis，服务端 503（tts_unavailable）时向上抛
// { unavailable: true }，由页面提示重试。
const config = require("../config");

let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  // iOS 静音键拨到静音也出声 —— 听写场景这是硬要求，不是可选项。
  wx.setInnerAudioOption({
    obeyMuteSwitch: false,
    mixWithOther: true,
  });
}

// url -> { path, degraded }。downloadFile 的临时文件在小程序存活期内有效，
// 同一个词的三遍音频（成品 WAV）命中后整个会话内免流量。
const cache = new Map();
const inFlight = new Set();

function isDegraded(header) {
  if (!header) return false;
  const keys = Object.keys(header);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === "x-tts-degraded" && header[keys[i]] === "1") return true;
  }
  return false;
}

function download(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success(res) {
        if (res.statusCode === 200) {
          resolve({ path: res.tempFilePath, degraded: isDegraded(res.header) });
        } else if (res.statusCode === 503) {
          const err = new Error("语音合成暂时不可用");
          err.unavailable = true;
          reject(err);
        } else {
          reject(new Error("音频下载失败了"));
        }
      },
      fail() {
        reject(new Error("网络好像断开了，请检查网络后重试"));
      },
    });
  });
}

// 预取：失败静默——正式播放时会再走一遍 download，那时才需要报错。
function prefetch(path) {
  const url = config.baseUrl + path;
  if (cache.has(url) || inFlight.has(url)) return;
  inFlight.add(url);
  download(url)
    .then((res) => cache.set(url, res))
    .catch(() => {})
    .then(() => inFlight.delete(url));
}

// 一个「播放通道」= 一个可被随时销毁的 InnerAudioContext。
// 听写页用 main，选词页的试听用 preview，互不干扰、各自先停再放。
function createEngine() {
  let token = 0;
  let current = null;

  function stop() {
    token += 1;
    if (current) {
      const ctx = current.ctx;
      current = null;
      try {
        ctx.destroy();
      } catch (e) {
        // destroy 在个别机型上会抛非致命错误，吞掉。
      }
    }
  }

  // play 返回的 Promise 在真正开始播放时 resolve（带 degraded 标记），
  // 播完由 onEnded 通知。中途任何新的 play/stop 都会让旧回调作废。
  function play(path, handlers) {
    const h = handlers || {};
    stop();
    const myToken = token;
    return download(config.baseUrl + path)
      .then((res) => {
        if (myToken !== token) return { canceled: true };
        const ctx = wx.createInnerAudioContext();
        ctx.obeyMuteSwitch = false;
        current = { ctx };
        ctx.src = res.path;
        ctx.onEnded(() => {
          if (myToken !== token) return;
          if (h.onEnded) h.onEnded();
        });
        ctx.onError(() => {
          if (myToken !== token) return;
          if (current && current.ctx === ctx) current = null;
          try {
            ctx.destroy();
          } catch (e) {
            // 同上。
          }
          if (h.onError) h.onError();
        });
        ctx.play();
        return { degraded: res.degraded };
      })
      .catch((err) => {
        if (myToken !== token) return { canceled: true };
        throw err;
      });
  }

  return { play, stop };
}

const main = createEngine();
const preview = createEngine();

module.exports = { init, prefetch, main, preview };

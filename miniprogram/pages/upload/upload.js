// 上传页（对应 Web 版 app/upload/page.tsx）。
// 通道差异：wx.request 发不了 multipart，选中的图片压缩后读成 base64
// data URL，走 POST /api/worksheet 的 application/json 入参（后端已支持，
// 与 Web 版 multipart 行为完全一致）。
const { request } = require("../../utils/request");

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

let idSeq = 0;

function mimeOf(path) {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  const ext = m ? m[1].toLowerCase() : "";
  return MIME_BY_EXT[ext] || "image/jpeg";
}

// 压缩：chooseMedia 已用 compressed 尺寸，这里再压一道质量（80），
// 失败（个别格式/机型）就回退原图，不阻断流程。
function compress(path) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: path,
      quality: 80,
      success: (res) => resolve(res.tempFilePath || path),
      fail: () => resolve(path),
    });
  });
}

function readBase64(path) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path,
      encoding: "base64",
      success: (res) => resolve(res.data),
      fail: () => reject(new Error("读取照片失败了，请重新选一次")),
    });
  });
}

Page({
  data: {
    images: [],
    submitting: false,
    error: null,
  },

  chooseImages() {
    const remaining = 9 - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: "一次最多 9 张", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (res) => {
        const picked = res.tempFiles.map((f) => ({
          id: `img-${++idSeq}`,
          path: f.tempFilePath,
        }));
        this.setData({
          images: this.data.images.concat(picked),
          error: null,
        });
      },
    });
  },

  removeImage(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ images: this.data.images.filter((img) => img.id !== id) });
  },

  resetAll() {
    this.setData({ images: [], error: null });
  },

  async submit() {
    if (this.data.images.length === 0 || this.data.submitting) return;
    this.setData({ submitting: true, error: null });

    try {
      const dataUrls = [];
      for (const img of this.data.images) {
        const path = await compress(img.path);
        const base64 = await readBase64(path);
        dataUrls.push(`data:${mimeOf(path)};base64,${base64}`);
      }

      const body = await request("/api/worksheet", {
        method: "POST",
        data: { images: dataUrls },
        timeout: 60000, // VLM 识别约 10 秒，留足余量
      });

      // D-19：选词页直接 GET /api/worksheet/:id，这里只带 id 跳转。
      wx.redirectTo({ url: `/pages/select/select?id=${body.worksheetId}` });
    } catch (err) {
      this.setData({ submitting: false, error: err.message });
    }
  },
});

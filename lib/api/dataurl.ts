// 小程序端上传通道：wx.request 只能发 JSON，选中的图片读成 base64 data URL
// 放进 { images: [...] }。这里把它解回与 multipart File 等价的形状，让
// /api/worksheet 的后续流程（校验、落盘、识别）与 Web 版完全共用。
import { ApiError } from "./errors";

export interface DataUrlImage {
  mime: string;
  name: string;
  bytes: Buffer;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

// 与 multipart 路径同样只收常见图片类型；多出来的类型在落盘扩展名上也没法
// 映射，早拒绝比落一个 .bin 好。
const DATA_URL_RE = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]*)$/;

export function parseDataUrlImages(input: unknown): DataUrlImage[] {
  if (typeof input !== "object" || input === null) {
    throw new ApiError("invalid_body", 400, "请求体格式不对");
  }
  const images = (input as { images?: unknown }).images;
  if (!Array.isArray(images) || images.length === 0) {
    throw new ApiError("no_images", 400, "请至少上传一张图片");
  }

  return images.map((item, i) => {
    if (typeof item !== "string") {
      throw new ApiError("invalid_body", 400, `第 ${i + 1} 张图片的数据格式不对`);
    }
    const m = DATA_URL_RE.exec(item);
    if (!m) {
      throw new ApiError("invalid_image_type", 400, `第 ${i + 1} 张图片不是支持的图片格式`);
    }
    const mime = m[1].toLowerCase();
    // 正则已限定 image/*，但扩展名表里没有的类型（如 image/tiff）同样拒绝，
    // 保持与 multipart 路径的 EXT_BY_MIME 行为一致。
    const ext = EXT_BY_MIME[mime];
    if (!ext) {
      throw new ApiError("invalid_image_type", 400, `第 ${i + 1} 张图片不是支持的图片格式`);
    }
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length === 0) {
      throw new ApiError("invalid_body", 400, `第 ${i + 1} 张图片是空的`);
    }
    return { mime, name: `img-${i + 1}${ext}`, bytes };
  });
}

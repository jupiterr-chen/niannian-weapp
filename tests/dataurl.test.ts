import { describe, expect, it } from "vitest";
import { parseDataUrlImages } from "../lib/api/dataurl";

// 与 lib/api/dataurl.ts 的纯正则/解码逻辑对齐；大小上限在路由层校验，不在这里。
const png1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const jpegTiny = "data:image/jpeg;base64,aGVsbG8="; // "hello"，解码合法性即可

describe("parseDataUrlImages", () => {
  it("解析多张图，保留 mime 并生成顺序文件名", () => {
    const out = parseDataUrlImages({ images: [png1x1, jpegTiny] });
    expect(out).toHaveLength(2);
    expect(out[0].mime).toBe("image/png");
    expect(out[0].name).toBe("img-1.png");
    expect(out[1].mime).toBe("image/jpeg");
    expect(out[1].name).toBe("img-2.jpg");
    expect(out[1].bytes.toString()).toBe("hello");
  });

  it("空数组 / 缺 images / 非对象一律拒绝", () => {
    expect(() => parseDataUrlImages({ images: [] })).toThrowError(/至少上传一张/);
    expect(() => parseDataUrlImages({})).toThrowError(/至少上传一张/);
    expect(() => parseDataUrlImages(null)).toThrowError(/请求体格式不对/);
  });

  it("非 data URL、非图片 mime、未收录的图片类型都拒绝", () => {
    expect(() => parseDataUrlImages({ images: ["https://x/y.png"] })).toThrowError(
      /不是支持的图片格式/
    );
    expect(() =>
      parseDataUrlImages({ images: ["data:text/plain;base64,aGk="] })
    ).toThrowError(/不是支持的图片格式/);
    expect(() =>
      parseDataUrlImages({ images: ["data:image/tiff;base64,aGk="] })
    ).toThrowError(/不是支持的图片格式/);
    expect(() => parseDataUrlImages({ images: [42] })).toThrowError(/数据格式不对/);
  });

  it("空 base64 载荷拒绝", () => {
    expect(() => parseDataUrlImages({ images: ["data:image/png;base64,"] })).toThrowError(
      /是空的/
    );
  });
});

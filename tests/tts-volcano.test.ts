// 覆盖 PROJECT.md §10.5/§10.6 引入的新逻辑：发音词典条目生成、语速映射、
// chunked 响应的增量 JSON 切分、WAV 头封装。取代已删除的 tests/tts-ssml.test.ts
// ——SSML 路径本身已经不存在了，这里测的是它的替代方案。
import { describe, it, expect } from "vitest";
import {
  buildPronunciationEntry,
  speedToSpeechRate,
  toneMarkToNumber,
  JsonObjectStream,
} from "../lib/tts/volcano";
import { encodeWav, silencePcm, readWavInfo } from "../lib/tts/wav";

describe("toneMarkToNumber", () => {
  it("声调符号转数字声调", () => {
    expect(toneMarkToNumber("zhǎng")).toBe("zhang3");
    expect(toneMarkToNumber("dà")).toBe("da4");
  });

  it("ü 系列写作 v", () => {
    expect(toneMarkToNumber("lǚ")).toBe("lv3");
    expect(toneMarkToNumber("ü")).toBe("v5");
  });

  it("无声调符号视为轻声（5）", () => {
    expect(toneMarkToNumber("zi")).toBe("zi5");
    expect(toneMarkToNumber("de")).toBe("de5");
  });
});

describe("buildPronunciationEntry", () => {
  it("§8 黄金真值多音字：长大 -> 长大/(zhang3)(da4)", () => {
    const result = buildPronunciationEntry("长大", "zhǎng dà");
    expect(result?.entry).toBe("长大/(zhang3)(da4)");
  });

  it("一本正经", () => {
    expect(buildPronunciationEntry("一本正经", "yī běn zhèng jīng")?.entry).toBe(
      "一本正经/(yi1)(ben3)(zheng4)(jing1)"
    );
  });

  it("心知肚明", () => {
    expect(buildPronunciationEntry("心知肚明", "xīn zhī dù míng")?.entry).toBe(
      "心知肚明/(xin1)(zhi1)(du4)(ming2)"
    );
  });

  it("识别", () => {
    expect(buildPronunciationEntry("识别", "shí bié")?.entry).toBe("识别/(shi2)(bie2)");
  });

  it("常识", () => {
    expect(buildPronunciationEntry("常识", "cháng shí")?.entry).toBe("常识/(chang2)(shi2)");
  });

  it("发现", () => {
    expect(buildPronunciationEntry("发现", "fā xiàn")?.entry).toBe("发现/(fa1)(xian4)");
  });

  it("出发", () => {
    expect(buildPronunciationEntry("出发", "chū fā")?.entry).toBe("出发/(chu1)(fa1)");
  });

  it("四海为家", () => {
    expect(buildPronunciationEntry("四海为家", "sì hǎi wéi jiā")?.entry).toBe(
      "四海为家/(si4)(hai3)(wei2)(jia1)"
    );
  });

  it("轻声字：胆子 -> zi 记 5 声", () => {
    expect(buildPronunciationEntry("胆子", "dǎn zi")?.entry).toBe("胆子/(dan3)(zi5)");
  });

  it("超过 9 字符时返回 null（§10.5 上限）", () => {
    expect(buildPronunciationEntry("一二三四五六七八九十", "yī èr sān sì wǔ liù qī bā jiǔ shí")).toBeNull();
  });

  it("含空格时返回 null", () => {
    expect(buildPronunciationEntry("长 大", "zhǎng dà")).toBeNull();
  });

  it("拼音音节数与汉字数不一致时返回 null", () => {
    expect(buildPronunciationEntry("一会儿", "yī huìr")).toBeNull(); // 3 字 2 音节
    expect(buildPronunciationEntry("长大", "zhǎng dà le")).toBeNull(); // 2 字 3 音节
  });
});

describe("speedToSpeechRate", () => {
  it("1.0 倍速映射为 0（正常语速）", () => {
    expect(speedToSpeechRate(1.0)).toBe(0);
  });

  it("0.8 倍速映射为 -20", () => {
    expect(speedToSpeechRate(0.8)).toBe(-20);
  });

  it("边界：0.5 -> -50，2.0 -> 100", () => {
    expect(speedToSpeechRate(0.5)).toBe(-50);
    expect(speedToSpeechRate(2.0)).toBe(100);
  });

  it("超出范围时截断到 [-50,100]", () => {
    expect(speedToSpeechRate(3.0)).toBe(100);
    expect(speedToSpeechRate(0.1)).toBe(-50);
  });
});

describe("JsonObjectStream", () => {
  it("单个 push 里包含多个完整对象", () => {
    const s = new JsonObjectStream();
    const out = s.push('{"code":0,"data":"AA=="}{"code":0,"data":"BB=="}');
    expect(out).toEqual([
      { code: 0, data: "AA==" },
      { code: 0, data: "BB==" },
    ]);
  });

  it("一个对象被切成多个网络分片（不在边界上）", () => {
    const s = new JsonObjectStream();
    const whole = '{"code":0,"message":"ok","data":"SGVsbG8="}';
    // 故意在字符串值内部切一刀，模拟「chunk 边界落在对象中间」的真实情况。
    const cut = 20;
    const out1 = s.push(whole.slice(0, cut));
    expect(out1).toEqual([]);
    const out2 = s.push(whole.slice(cut));
    expect(out2).toEqual([{ code: 0, message: "ok", data: "SGVsbG8=" }]);
  });

  it("对象之间有换行分隔时同样正确解析", () => {
    const s = new JsonObjectStream();
    const out = s.push('{"code":0,"data":"AA=="}\n{"code":0,"data":"BB=="}\n');
    expect(out).toEqual([
      { code: 0, data: "AA==" },
      { code: 0, data: "BB==" },
    ]);
  });

  it("字符串值里的花括号不会打乱深度计数", () => {
    const s = new JsonObjectStream();
    const out = s.push('{"code":0,"message":"a{b}c"}');
    expect(out).toEqual([{ code: 0, message: "a{b}c" }]);
  });

  it("非 0 code 的分片依然会被完整解析出来（由调用方决定报错）", () => {
    const s = new JsonObjectStream();
    const out = s.push('{"code":45000001,"message":"参数错误"}');
    expect(out).toEqual([{ code: 45000001, message: "参数错误" }]);
  });
});

describe("wav 工具", () => {
  it("encodeWav 写出的头部字段可以被 readWavInfo 正确读回", () => {
    const pcm = silencePcm(1000, 16000); // 1 秒 16kHz 单声道静音
    const wav = encodeWav(pcm, { sampleRate: 16000 });
    const info = readWavInfo(wav);
    expect(info.valid).toBe(true);
    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataSize).toBe(pcm.length);
    expect(info.durationSec).toBeCloseTo(1, 2);
  });

  it("silencePcm 生成的字节全部为 0，长度 = duration * sampleRate * 2 字节", () => {
    const pcm = silencePcm(500, 24000); // 0.5 秒 24kHz
    expect(pcm.length).toBe(Math.round(0.5 * 24000) * 2);
    expect(pcm.every((b) => b === 0)).toBe(true);
  });

  it("readWavInfo 对非法数据返回 valid:false", () => {
    expect(readWavInfo(Buffer.from("not a wav")).valid).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { buildPhonemeSpan } from "../lib/tts/volcano";

describe("buildPhonemeSpan", () => {
  it("汉字数与拼音音节数匹配时正常注音", () => {
    const result = buildPhonemeSpan("长大", "zhǎng dà");
    expect(result.annotated).toBe(true);
    expect(result.span).toContain('<phoneme alphabet="py" ph="zhang3">长</phoneme>');
    expect(result.span).toContain('<phoneme alphabet="py" ph="da4">大</phoneme>');
  });

  it("汉字数与拼音音节数不匹配时 annotated 为 false（这是本次要堵住的降级缺口）", () => {
    // 儿化词的典型情况：3 个汉字只有 2 个音节。
    const result = buildPhonemeSpan("一会儿", "yī huìr");
    expect(result.annotated).toBe(false);
  });

  it("音节数比汉字数多时同样判 annotated 为 false", () => {
    const result = buildPhonemeSpan("长大", "zhǎng dà le");
    expect(result.annotated).toBe(false);
  });

  it("不匹配时退化为不带 <phoneme> 标签的转义纯文本，而不是猜一个可能错位的映射", () => {
    const result = buildPhonemeSpan("一会儿", "yī huìr");
    expect(result.span).not.toContain("<phoneme");
    expect(result.span).toBe("一会儿");
  });

  it("退化路径仍然会转义 XML 特殊字符", () => {
    const result = buildPhonemeSpan("A&B", "ei bi");
    expect(result.annotated).toBe(false);
    expect(result.span).toBe("A&amp;B");
  });
});

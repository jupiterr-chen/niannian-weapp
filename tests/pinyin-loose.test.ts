import { describe, it, expect } from "vitest";
import { comparePinyinLoose } from "../lib/pinyin";

describe("comparePinyinLoose", () => {
  it("胆子: dǎn zi (黄金真值) 与 dǎn zǐ (pinyin-pro 实际给出) 视为相等", () => {
    expect(comparePinyinLoose("胆子", "dǎn zi", "dǎn zǐ")).toBe(true);
  });

  it("肚子: dù zi 与 dù zǐ 视为相等（同样是轻声字位）", () => {
    expect(comparePinyinLoose("肚子", "dù zi", "dù zǐ")).toBe(true);
  });

  it("长大: zhǎng dà 与 cháng dà 视为不等（多音字必须严格区分，不能被放宽逻辑掩盖）", () => {
    expect(comparePinyinLoose("长大", "zhǎng dà", "cháng dà")).toBe(false);
  });

  it("非轻声位置的声调差异仍然判不等（如果 rú guǒ vs rù guǒ）", () => {
    expect(comparePinyinLoose("如果", "rú guǒ", "rù guǒ")).toBe(false);
  });

  it("完全一致的拼音总是判等", () => {
    expect(comparePinyinLoose("如果", "rú guǒ", "rú guǒ")).toBe(true);
  });

  it("轻声字位声调不同但基础音节也不同时仍判不等（防止放宽逻辑过头）", () => {
    // 假设第二个字读音完全不搭边（zi vs ma），即便该字位是轻声候选字，
    // 去掉声调后的基础音节也不一样，不应该被判等。
    expect(comparePinyinLoose("胆子", "dǎn zi", "dǎn ma")).toBe(false);
  });

  it("字数与音节数对不齐时退化为整串严格比较（comparePinyin 行为）", () => {
    // "胆子" 是 2 个字，但传入的拼音只有 1 个音节，无法按位对齐。
    expect(comparePinyinLoose("胆子", "dǎnzi", "dǎnzi")).toBe(true);
    expect(comparePinyinLoose("胆子", "dǎnzi", "dǎnzǐ")).toBe(false);
  });
});

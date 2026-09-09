import { describe, it, expect } from "vitest";
import { normalize } from "../lib/core/normalize";

describe("normalize", () => {
  it("strips full-width spaces", () => {
    expect(normalize("如　果")).toBe(normalize("如果"));
    expect(normalize("如果")).toBe("如果");
  });

  it("strips trailing punctuation (including full-width)", () => {
    expect(normalize("如果。")).toBe(normalize("如果"));
    expect(normalize("如果，")).toBe("如果");
    expect(normalize("如果!")).toBe("如果");
  });

  it("does not conflate visually similar but different characters", () => {
    expect(normalize("如菓")).not.toBe(normalize("如果"));
  });

  it("converts traditional to simplified via the built-in map", () => {
    expect(normalize("經過")).toBe("经过");
    expect(normalize("經過")).toBe(normalize("经过"));
  });

  it("converts full-width alphanumerics to half-width", () => {
    expect(normalize("ＡＢＣ１２３")).toBe("ABC123");
  });

  it("leaves characters not in the traditional map untouched", () => {
    expect(normalize("你好")).toBe("你好");
  });

  it("handles empty and whitespace-only input without throwing", () => {
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
    expect(normalize("　　")).toBe("");
  });

  it("strips internal whitespace between words, not only at edges", () => {
    expect(normalize("如果 已经")).toBe("如果已经");
  });
});

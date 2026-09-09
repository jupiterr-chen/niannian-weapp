import { pinyin } from "pinyin-pro";

// toneSandhi:false so "一" stays "yī" (PROJECT.md §8 黄金真值 requires
// "一本正经" -> "yī běn zhèng jīng", not the spoken-sandhi "yì").
const PINYIN_OPTIONS = { toneSandhi: false } as const;

export function toPinyin(text: string): string {
  return pinyin(text, { ...PINYIN_OPTIONS, type: "string" }).trim();
}

function normalizeForCompare(s: string): string {
  return s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function comparePinyin(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

// A short list of high-frequency characters, consulted before the full
// U+4E00-U+9FA5 sweep so that suggestHomophone() prefers common substitutes
// (e.g. "涨" over an obscure character that also reads "zhǎng").
const COMMON_CHARS =
  "的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严";

let reverseIndex: Map<string, string[]> | null = null;

function getReverseIndex(): Map<string, string[]> {
  if (reverseIndex) return reverseIndex;
  const map = new Map<string, string[]>();
  const add = (ch: string): void => {
    let reading: string;
    try {
      reading = pinyin(ch, PINYIN_OPTIONS) as string;
    } catch {
      return;
    }
    // Skip anything that isn't a single-syllable hanzi reading (e.g. the
    // library echoing back a non-Chinese character unchanged).
    if (!reading || reading.includes(" ") || reading === ch) return;
    const existing = map.get(reading);
    if (existing) {
      if (!existing.includes(ch)) existing.push(ch);
    } else {
      map.set(reading, [ch]);
    }
  };
  for (const ch of COMMON_CHARS) add(ch);
  for (let cp = 0x4e00; cp <= 0x9fa5; cp++) add(String.fromCodePoint(cp));
  reverseIndex = map;
  return map;
}

// Fallback for the "读音不对" flow (PROJECT.md §5.3 第 3 层防线): when SSML
// and plain-text TTS both mispronounce a word, suggest a same-sounding
// substitute word made of common characters so plain-text synthesis reads it
// correctly. Not a general homophone dictionary — just enough to unblock TTS.
export function suggestHomophone(text: string, targetPinyin: string): string {
  const syllables = targetPinyin.trim().split(/\s+/).filter(Boolean);
  if (syllables.length === 0) return text;
  const index = getReverseIndex();
  const chars: string[] = [];
  for (const syllable of syllables) {
    const candidates = index.get(syllable);
    if (!candidates || candidates.length === 0) return text;
    chars.push(candidates[0]);
  }
  return chars.join("");
}

// D-13：pinyin-pro 对一些不太常见的「X子/X头/X们…」组合给不出中性调（如
// 「胆子」标成 dǎn zǐ 而不是词典意义上的轻声 dǎn zi），导致 crossCheckPinyin
// 对着完全正确的模型结果报「拼音存疑」。这类假阳性喊多了，家长会学会无视
// 黄色标记，整条防线就作废了。
//
// 修法不是放宽全局比较（那样会漏掉真正的多音字错误，比如「长大」的
// zhǎng/cháng之争必须严格保留），而是只在轻声高发的字位上放宽：
// 这些字位只比不带声调的基础音节，其它位置仍然要求声调完全一致。
//
// 只有 Unicode 组合重音符号（宏音、锐音、抑扬、钝音，对应一二三四声）被剥
// 离；ü 的分音符（U+0308）不在剥离范围内，所以 lǜ/lù 之类会保留区别，不会
// 被误判为「基础音节相同」。
const NEUTRAL_TONE_CANDIDATE_CHARS = new Set([
  "子", "头", "们", "么", "的", "了", "着", "过", "吧", "呢", "吗", "儿",
]);

// macron(1声) U+0304 / acute(2声) U+0301 / caron(3声) U+030C / grave(4声) U+0300
// 字符类里直接放四个 Unicode 组合重音符号本身（非转义写法），已用逐字符 codePointAt 校验过确实是 U+0304/0301/030C/0300 这四个，互不重复。
const TONE_DIACRITICS = /[̄́̌̀]/g;

function stripToneMark(syllable: string): string {
  return syllable.normalize("NFD").replace(TONE_DIACRITICS, "").normalize("NFC");
}

// 按字对齐比较两个拼音串是否代表同一个读音：text 里落在轻声候选字集合里的
// 位置，只比较去掉声调后的基础音节（dǎn zǐ 的 "zǐ" 和 dǎn zi 的 "zi" 都会
// 先变成 "zi" 再比较）；其余位置仍然要求声调完全一致。text 的字数和两个拼音
// 串的音节数对不齐时（数据本身有问题），没法可靠地按位对应，退化成和
// comparePinyin 一样的整串严格比较。
export function comparePinyinLoose(text: string, a: string, b: string): boolean {
  const chars = Array.from(text);
  const syllablesA = normalizeForCompare(a).split(" ").filter(Boolean);
  const syllablesB = normalizeForCompare(b).split(" ").filter(Boolean);

  if (chars.length === 0 || syllablesA.length !== chars.length || syllablesB.length !== chars.length) {
    return comparePinyin(a, b);
  }

  for (let i = 0; i < chars.length; i++) {
    const syllableA = syllablesA[i];
    const syllableB = syllablesB[i];
    if (NEUTRAL_TONE_CANDIDATE_CHARS.has(chars[i])) {
      if (stripToneMark(syllableA) !== stripToneMark(syllableB)) return false;
    } else if (syllableA !== syllableB) {
      return false;
    }
  }
  return true;
}

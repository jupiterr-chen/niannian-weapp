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

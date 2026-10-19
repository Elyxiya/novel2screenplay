/**
 * 网文噪声行清洗（FIX-11）
 *
 * 在章节解析（parseNovel）之前对原文做行级清洗，剔除盗版站点水印、催更/广告行、
 * 章尾引导语与乱码行。设计原则（防误删）：
 * - 每条规则都要求 **≥2 个信号**（关键词 + 行长，或字符分布 + 行长）；水印规则
 *   属高专有单一特征（域名/本站名），单独成立；
 * - 长正文行（>60 字）即便含广告词也保留（广告行几乎都短）；
 * - 所有删除逐行留痕（按规则计数 + 少量样本），随 job 落库供审计。
 */

export type PreprocessRule = 'ad' | 'watermark' | 'chapter-tail' | 'garbled';

export interface PreprocessReport {
  /** 被移除的行数 */
  removedLines: number;
  /** 按规则计数的移除明细 */
  byRule: Record<string, number>;
  /** 审计样本（移除行的截断副本，上限 maxSamples） */
  samples: string[];
}

export interface CleanResult {
  /** 清洗后的文本（未命中规则的行原样保留） */
  text: string;
  report: PreprocessReport;
}

/** 广告/催更关键词（需与"短行"信号叠加） */
const AD_KEYWORDS = /(请收藏|请记住本站|天才一秒|笔趣阁|起点中文|手机版阅读|手机版|加入书签|投推荐票|求月票|求订阅|求打赏|求推荐票|微信公众号|QQ群|书友群|加群|扫码|关注公众号|最新章节)/i;
/** 站点水印（高专有特征：域名或本站标识，单独成立） */
const WATERMARK = /(www\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|[\w-]+\.(com|net|org|cc|cn|la|info)(\/|\b))/i;
/** 章尾引导语 */
const CHAPTER_TAIL = /(本章未完|未完待续|点击下一页|下一页继续阅读|翻页继续)/;
/** 短行阈值：广告/章尾规则仅在行 ≤ 该长度时生效 */
const SHORT_LINE_LIMIT = 60;
/** 乱码行最小长度 */
const GARBLED_MIN_LENGTH = 4;
/** 非常用字符占比阈值 */
const GARBLED_RATIO = 0.6;

/** 认定为"可读文本"的字符集：中日韩、全角标点、ASCII 字母数字与常见标点 */
const READABLE_CHAR = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffefA-Za-z0-9\s，。！？；：、“”‘’（）《》〈〉…—·\-,.!?;:'"()[\]{}]/;

function garbledRatio(line: string): number {
  const chars = [...line];
  if (chars.length === 0) return 0;
  let bad = 0;
  for (const ch of chars) {
    if (!READABLE_CHAR.test(ch)) bad += 1;
  }
  return bad / chars.length;
}

/** 判定单行是否移除：返回命中的规则或 null */
export function classifyNoiseLine(line: string): PreprocessRule | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (WATERMARK.test(trimmed)) return 'watermark';
  if (CHAPTER_TAIL.test(trimmed) && trimmed.length <= SHORT_LINE_LIMIT) return 'chapter-tail';
  if (AD_KEYWORDS.test(trimmed) && trimmed.length <= SHORT_LINE_LIMIT) return 'ad';
  if ([...trimmed].length >= GARBLED_MIN_LENGTH && garbledRatio(trimmed) > GARBLED_RATIO) return 'garbled';

  return null;
}

/**
 * 行尾归一（P0）：CRLF / CR → LF。
 *
 * 章节与场景偏移全部按 `\n` 计算（`Phase2Segmenter.calculateCharOffsets`），
 * 混入 `\r` 会让每个段落的偏移累计漂移，最终 Phase 3 切出的「原文片段」错位且不报错。
 * Windows 上编辑的 .txt 默认是 CRLF，因此必须在解析入口统一。
 */
export function normalizeLineEndings(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

export function cleanNovelText(raw: string, opts: { maxSamples?: number } = {}): CleanResult {
  const maxSamples = opts.maxSamples ?? 20;
  const byRule: Record<string, number> = {};
  const samples: string[] = [];
  let removedLines = 0;

  // P0：先归一化行尾，保证后续按 \n 切行与偏移计算一致
  const lines = normalizeLineEndings(raw).split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const rule = classifyNoiseLine(line);
    if (!rule) {
      kept.push(line);
      continue;
    }
    removedLines += 1;
    byRule[rule] = (byRule[rule] ?? 0) + 1;
    if (samples.length < maxSamples) {
      samples.push(line.trim().slice(0, 60));
    }
  }

  return {
    text: kept.join('\n'),
    report: { removedLines, byRule, samples },
  };
}

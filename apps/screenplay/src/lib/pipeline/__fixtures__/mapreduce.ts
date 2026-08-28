/**
 * Phase1 map-reduce 测试 fixtures。
 * (a) 超级长单章：>30000 token（字符数 >= 42000，约 = 42000*1.3 ≈ 54600 token 估算，远超阈值）用于测分块。
 * (b) 多章短片：老秦(第5章)与秦爷(第12章)指同一人，用于测 put 归并。
 */
import type { ChapterInput } from '../phase1-map';

/** 固定用的一句能反复拼凑的文本，确保总字符数足够大 */
const SENTENCE =
  '深夜的集市渐渐安静下来，商贩们收拾着摊子，唯有远处的钟楼还亮着一盏昏黄的灯。旅人裹紧披风，走进巷口那家不起眼的水面店，要了一碗热气腾腾的面。';

/**
 * (a) 大于 30000 token 的单章合成文本（字符数 >= 42000）。
 * 用重复语句拼装，免人工标注，确定性可复现。
 */
export function buildOversizeChapter(extraChars = 46000): ChapterInput {
  // 确保至少 extraChars 个字符
  const repeats = Math.ceil(extraChars / SENTENCE.length);
  const text = Array.from({ length: repeats }, (_, i) => `第${i + 1}段。${SENTENCE}`).join('\n');
  return { index: 0, title: '超长单章', text };
}

/** 保证构建出的章节字符串长度（供测试断言用） */
export const OVERSIZE_MIN_CHARS = 46000;

/**
 * (b) 多章短片：第5章出现"老秦"，第12章出现"秦爷"（同一人）。
 * 每章含 summary 与 openThreads，供 reduce 归并测试。
 */
export function buildMultiChapterPiece(): ChapterInput[] {
  const chapter5Text = `
    老秦坐在屋檐下擦他的烟斗，慢慢地没有说话。
    今天是赶集日，他把背篓里的山货摆了一地，有人来问价，他便报个价，从不添多一句。
  `;
  const chapter12Text = `
    秦爷从马车上下来，拍了拍袍角的灰。这一趟他走了很远的路，只为一件旧事。
    集市那头的面老板娘迎上来喊他"老秦"，他笑着摆摆手。
  `;
  const other = `路上行人不多，清晨的雾气还没散尽。`;

  return [
    { index: 5, title: '第五章', text: chapter5Text },
    { index: 12, title: '第十二章', text: chapter12Text },
    { index: 3, title: '第三章', text: other },
  ];
}
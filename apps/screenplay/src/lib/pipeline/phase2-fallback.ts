/**
 * Phase 2 兜底切分（LLM 不可用/失败时走这里）。
 *
 * 为什么单独成模块：兜底路径此前直接 `split(/\n\s*\n/)`（按空行分块），
 * 而主路径与 prompt 早已统一为「段落 = 一个非空行」。两条路径口径不同，
 * 一旦触发兜底，startParagraph/endParagraph 会指向块序号而不是行号，
 * 后续按段号取原文就会错位——而且不报错，只是内容悄悄错。
 *
 * 这里把「行号、字符偏移、按 token 预算分组」拆成纯函数，便于单测覆盖。
 */

export interface FallbackParagraph {
  /** 在原文中的行号（0 起，与 startParagraph 同一坐标系） */
  index: number;
  text: string;
  /** 该行在原文中的起止字符偏移 */
  start: number;
  end: number;
}

export interface FallbackSceneSpan {
  startParagraph: number;
  endParagraph: number;
  originalStartOffset: number;
  originalEndOffset: number;
  summary: string;
}

/** 按「非空行」切段，并记录每行的行号与字符偏移（保留原始换行位置） */
export function splitParagraphsWithOffsets(text: string): FallbackParagraph[] {
  const lines = text.split('\n');
  const out: FallbackParagraph[] = [];
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length > 0) {
      out.push({ index: i, text: line, start: cursor, end: cursor + line.length });
    }
    cursor += line.length + 1; // +1 为换行符
  }
  return out;
}

/**
 * 按 token 预算把段分组为场景（贪心累加，超预算即切）。
 * tokens 必须与 paragraphs 一一对应；返回的区间是**闭区间行号**。
 */
export function groupParagraphsIntoScenes(
  paragraphs: FallbackParagraph[],
  tokens: number[],
  maxTokens: number,
): FallbackSceneSpan[] {
  const spans: FallbackSceneSpan[] = [];
  if (paragraphs.length === 0) return spans;

  const emit = (from: number, to: number) => {
    const head = paragraphs[from];
    const tail = paragraphs[to];
    const joined = paragraphs
      .slice(from, to + 1)
      .map((p) => p.text)
      .join('');
    spans.push({
      startParagraph: head.index,
      endParagraph: tail.index,
      originalStartOffset: head.start,
      originalEndOffset: tail.end,
      summary: joined.slice(0, 50) + '...',
    });
  };

  let sceneStart = 0;
  let acc = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const cost = tokens[i] ?? 0;
    if (acc > 0 && acc + cost > maxTokens) {
      emit(sceneStart, i - 1);
      sceneStart = i;
      acc = 0;
    }
    acc += cost;
    if (i === paragraphs.length - 1) emit(sceneStart, i);
  }
  return spans;
}

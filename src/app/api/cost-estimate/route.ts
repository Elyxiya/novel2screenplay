import { NextRequest, NextResponse } from 'next/server';

/**
 * token 成本预估（近似估算）
 *
 * 不做 tiktoken 精确编码：全文字符数可能达几十万，精确编码耗时数秒，
 * 会让"首次进入配置页"的预估看起来不生效。改用中文 1.3 token/字的
 * 经验系数秒回，作为成本预估精度完全够用。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get('text') || '';
  const chars = searchParams.get('chars');

  let charCount: number;
  if (text) {
    charCount = text.length;
  } else if (chars) {
    const n = parseInt(chars, 10);
    if (isNaN(n) || n < 0) return NextResponse.json({ error: '无效字数' }, { status: 400 });
    charCount = n;
  } else {
    return NextResponse.json({ error: '提供 text 或 chars 参数' }, { status: 400 });
  }

  if (charCount === 0) {
    return NextResponse.json({
      estimatedTokens: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0,
      estimatedCalls: { phase1: 0, phase2: 0, phase3: 0 }, estimatedCostCNY: 0,
    });
  }

  // cl100k_base 对中文约 1.3 token/字（经验系数，避免超长文本精确编码卡顿）
  const tokens = Math.max(1, Math.ceil(charCount * 1.3));
  const inputTokens = tokens;
  const outputTokens = Math.ceil(tokens * 0.3);
  const costCNY = (inputTokens / 1_000_000) + (outputTokens / 1_000_000) * 2;

  return NextResponse.json({
    estimatedTokens: inputTokens + outputTokens,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCalls: {
      phase1: 1,
      phase2: Math.max(1, Math.ceil(charCount / 5000)),
      phase3: Math.max(1, Math.ceil(charCount / 800)),
    },
    estimatedCostCNY: Math.round(costCNY * 1000) / 1000,
    warning: '预估仅供参考，实际费用取决于场景数量与转换质量，通常不超过 0.1 元/次',
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { ContextManager } from '@/lib/pipeline/ContextManager';

const ctx = new ContextManager();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get('text') || '';
  const chars = searchParams.get('chars');

  let target = text;
  if (!target && chars) { const n = parseInt(chars, 10); if (isNaN(n) || n <= 0) return NextResponse.json({ error: '无效字数' }, { status: 400 }); target = '字'.repeat(n); }
  if (!target) return NextResponse.json({ error: '提供 text 或 chars 参数' }, { status: 400 });

  const tokens = await ctx.countTokens(target);
  const inputTokens = tokens;
  const outputTokens = Math.ceil(tokens * 0.3);
  const costCNY = (inputTokens / 1_000_000) + (outputTokens / 1_000_000) * 2;

  return NextResponse.json({
    estimatedTokens: inputTokens + outputTokens, estimatedInputTokens: inputTokens, estimatedOutputTokens: outputTokens,
    estimatedCalls: { phase1: 1, phase2: Math.max(1, Math.ceil(target.length / 5000)), phase3: Math.max(1, Math.ceil(target.length / 800)) },
    estimatedCostCNY: Math.round(costCNY * 1000) / 1000,
    warning: '预估仅供参考，实际费用取决于场景数量与转换质量，通常不超过 0.1 元/次',
  });
}

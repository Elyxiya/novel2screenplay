import { NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { initializeProviders, llmRegistry } from '@/lib/llm/registry';
import { runBenchmark } from '@/lib/eval/benchmark';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Turbopack dev 下各 route 模块图独立，此处确保 provider 已注册
initializeProviders();

/**
 * 质量基准集 API（P-评估）
 *
 * POST /api/debug/quality-benchmark → 登录后触发 LLM 质量基准评估，
 * 对内置基准样本逐份打分并校验区分度。
 * 注意：消耗真实 LLM 调用（约 8 次），请勿频繁触发。
 */
export async function POST(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return authError();

  const provider = llmRegistry.getDefault();
  if (!provider) {
    return NextResponse.json({ error: '未配置 LLM Provider' }, { status: 503 });
  }

  try {
    const report = await runBenchmark(provider);
    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: `基准评估失败: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}

/**
 * Models API Endpoint
 *
 * GET /api/models
 * 返回可用模型列表，包含适配器信息和成本。
 */

import { NextResponse } from 'next/server';
import { getModelRouter } from '@/lib/llm/adapter';
import { getBudgetController, BudgetController } from '@/lib/llm/adapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const router = getModelRouter();
  const budgetController = getBudgetController();

  // 获取支持的模型列表
  const models = router.listSupportedModels();

  // 获取预算使用情况
  const budgetSummary = budgetController.getUsageSummary();

  // 获取各适配器健康状态
  const adapters = models.reduce<Array<{
    adapterId: string;
    adapterName: string;
    models: Array<{
      modelId: string;
      cost: { inputCost: number; outputCost: number };
      health: string;
    }>;
  }>>((acc, m) => {
    const existing = acc.find((a) => a.adapterId === m.adapterId);
    if (existing) {
      existing.models.push({
        modelId: m.modelId,
        cost: BudgetController.getModelCost(m.modelId),
        health: router.getAdapter(m.adapterId)?.getHealth().status ?? 'unknown',
      });
    } else {
      acc.push({
        adapterId: m.adapterId,
        adapterName: m.adapterName,
        models: [{
          modelId: m.modelId,
          cost: BudgetController.getModelCost(m.modelId),
          health: router.getAdapter(m.adapterId)?.getHealth().status ?? 'unknown',
        }],
      });
    }
    return acc;
  }, []);

  return NextResponse.json({
    adapters,
    defaultModel: router.getDefaultModel(),
    budget: {
      monthly: budgetSummary.monthly,
      hourly: budgetSummary.hourly,
      minute: budgetSummary.minute,
    },
    router: {
      totalRequests: router.getStats().totalRequests,
      successfulRequests: router.getStats().successfulRequests,
      failedRequests: router.getStats().failedRequests,
    },
  });
}

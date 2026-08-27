/**
 * Models API Endpoint
 *
 * GET /api/models
 * 返回可用模型列表，包含适配器信息和成本。
 */

import { NextResponse } from 'next/server';
import { getModelRouter } from '@/lib/llm/adapter';
import { getBudgetController, BudgetController } from '@/lib/llm/adapter';
import { getCurrentUser } from '@/lib/auth';
import { listModelsForUser } from '@/lib/llm/llm-gateway';

export const dynamic = 'force-dynamic';

export async function GET() {
  const router = getModelRouter();
  const budgetController = getBudgetController();

  // 获取支持的模型列表
  const models = router.listSupportedModels();

  // 获取预算使用情况
  const budgetSummary = budgetController.getUsageSummary();

  // 当前登录用户导入的自定义 LLM（若已导入则作为默认模型优先级）
  const user = await getCurrentUser();
  const userDefaultModel = user ? listModelsForUser(user.id)[0]?.defaultModel : undefined;

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

  // 注入当前用户导入的自定义 LLM（用户级，key 不出库）
  if (user) {
    for (const d of listModelsForUser(user.id)) {
      adapters.push({
        adapterId: d.adapterId,
        adapterName: d.adapterName,
        models: d.models.map((m) => ({
          modelId: m.modelId,
          cost: { inputCost: 0, outputCost: 0 },
          health: 'healthy',
        })),
      });
    }
  }

  return NextResponse.json({
    adapters,
    defaultModel: userDefaultModel ?? router.getDefaultModel(),
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

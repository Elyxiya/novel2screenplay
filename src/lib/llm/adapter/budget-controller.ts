/**
 * 模型预算控制器
 *
 * 管理 LLM 使用的预算和成本控制。
 */

export interface BudgetConfig {
  /** 每月预算限制（USD） */
  monthlyLimit: number;
  /** 每小时预算限制（USD） */
  hourlyLimit: number;
  /** 每分钟预算限制（USD） */
  minuteLimit: number;
  /** 警告阈值（百分比） */
  warningThreshold: number;
}

export interface BudgetUsage {
  /** 总使用量 */
  total: number;
  /** 预算限制 */
  limit: number;
  /** 使用百分比 */
  percentage: number;
  /** 剩余预算 */
  remaining: number;
  /** 最后更新时间 */
  lastUpdate: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelCost {
  inputCost: number;
  outputCost: number;
}

const MODEL_COSTS: Record<string, ModelCost> = {
  'deepseek-chat': { inputCost: 0.1, outputCost: 0.3 },
  'deepseek-coder': { inputCost: 0.1, outputCost: 0.3 },
  'deepseek-reasoner': { inputCost: 0.5, outputCost: 2.0 },
  'gpt-4o': { inputCost: 5.0, outputCost: 15.0 },
  'gpt-4o-mini': { inputCost: 0.15, outputCost: 0.6 },
  'gpt-4-turbo': { inputCost: 10.0, outputCost: 30.0 },
  'gpt-3.5-turbo': { inputCost: 0.5, outputCost: 1.5 },
};

export class BudgetController {
  private config: BudgetConfig;
  private hourlyUsage = new Map<number, number>(); // hour timestamp -> usage
  private minuteUsage = new Map<number, number>(); // minute timestamp -> usage
  private monthlyUsage = 0;
  private totalUsage = 0;
  private lastResetHour = this.getCurrentHour();
  private lastResetMinute = this.getCurrentMinute();
  private lastResetMonth = this.getCurrentMonth();

  constructor(config?: Partial<BudgetConfig>) {
    this.config = {
      monthlyLimit: config?.monthlyLimit ?? 100,
      hourlyLimit: config?.hourlyLimit ?? 10,
      minuteLimit: config?.minuteLimit ?? 1,
      warningThreshold: config?.warningThreshold ?? 0.8,
    };
  }

  /**
   * 检查是否可以执行请求
   */
  canRequest(modelId: string, estimatedTokens?: TokenUsage): { allowed: boolean; reason?: string } {
    this.resetIfNeeded();

    const modelCost = MODEL_COSTS[modelId] ?? { inputCost: 0.5, outputCost: 1.0 };
    let estimatedCost = 0;

    if (estimatedTokens) {
      estimatedCost =
        (estimatedTokens.promptTokens / 1_000_000) * modelCost.inputCost +
        (estimatedTokens.completionTokens / 1_000_000) * modelCost.outputCost;
    }

    // 检查月度预算
    const monthlyUsage = this.getMonthlyUsage();
    if (monthlyUsage + estimatedCost > this.config.monthlyLimit) {
      return { allowed: false, reason: '月度预算已超支' };
    }

    // 检查小时预算
    const hourlyUsage = this.getHourlyUsage();
    if (hourlyUsage + estimatedCost > this.config.hourlyLimit) {
      return { allowed: false, reason: '小时预算已超支' };
    }

    // 检查分钟预算
    const minuteUsage = this.getMinuteUsage();
    if (minuteUsage + estimatedCost > this.config.minuteLimit) {
      return { allowed: false, reason: '分钟预算已超支' };
    }

    return { allowed: true };
  }

  /**
   * 记录使用量
   */
  recordUsage(modelId: string, usage: TokenUsage): void {
    this.resetIfNeeded();

    const modelCost = MODEL_COSTS[modelId] ?? { inputCost: 0.5, outputCost: 1.0 };
    const cost =
      (usage.promptTokens / 1_000_000) * modelCost.inputCost +
      (usage.completionTokens / 1_000_000) * modelCost.outputCost;

    const hourKey = this.getCurrentHour();
    const minuteKey = this.getCurrentMinute();

    // 更新使用量
    const currentHourUsage = this.hourlyUsage.get(hourKey) ?? 0;
    this.hourlyUsage.set(hourKey, currentHourUsage + cost);

    const currentMinuteUsage = this.minuteUsage.get(minuteKey) ?? 0;
    this.minuteUsage.set(minuteKey, currentMinuteUsage + cost);

    this.monthlyUsage += cost;
    this.totalUsage += cost;
  }

  /**
   * 获取月度使用情况
   */
  getMonthlyUsage(): number {
    this.resetIfNeeded();
    return this.monthlyUsage;
  }

  /**
   * 获取小时使用情况
   */
  getHourlyUsage(): number {
    this.resetIfNeeded();
    const hourKey = this.getCurrentHour();
    return this.hourlyUsage.get(hourKey) ?? 0;
  }

  /**
   * 获取分钟使用情况
   */
  getMinuteUsage(): number {
    this.resetIfNeeded();
    const minuteKey = this.getCurrentMinute();
    return this.minuteUsage.get(minuteKey) ?? 0;
  }

  /**
   * 获取使用情况摘要
   */
  getUsageSummary(): {
    total: BudgetUsage;
    monthly: BudgetUsage;
    hourly: BudgetUsage;
    minute: BudgetUsage;
  } {
    this.resetIfNeeded();

    return {
      total: {
        total: this.totalUsage,
        limit: Infinity,
        percentage: 0,
        remaining: Infinity,
        lastUpdate: Date.now(),
      },
      monthly: {
        total: this.monthlyUsage,
        limit: this.config.monthlyLimit,
        percentage: (this.monthlyUsage / this.config.monthlyLimit) * 100,
        remaining: this.config.monthlyLimit - this.monthlyUsage,
        lastUpdate: Date.now(),
      },
      hourly: {
        total: this.getHourlyUsage(),
        limit: this.config.hourlyLimit,
        percentage: (this.getHourlyUsage() / this.config.hourlyLimit) * 100,
        remaining: this.config.hourlyLimit - this.getHourlyUsage(),
        lastUpdate: Date.now(),
      },
      minute: {
        total: this.getMinuteUsage(),
        limit: this.config.minuteLimit,
        percentage: (this.getMinuteUsage() / this.config.minuteLimit) * 100,
        remaining: this.config.minuteLimit - this.getMinuteUsage(),
        lastUpdate: Date.now(),
      },
    };
  }

  /**
   * 检查是否需要警告
   */
  shouldWarn(): { warning: boolean; type: 'monthly' | 'hourly' | 'minute' | null; percentage: number } {
    const summary = this.getUsageSummary();

    if (summary.monthly.percentage >= this.config.warningThreshold * 100) {
      return { warning: true, type: 'monthly', percentage: summary.monthly.percentage };
    }
    if (summary.hourly.percentage >= this.config.warningThreshold * 100) {
      return { warning: true, type: 'hourly', percentage: summary.hourly.percentage };
    }
    if (summary.minute.percentage >= this.config.warningThreshold * 100) {
      return { warning: true, type: 'minute', percentage: summary.minute.percentage };
    }

    return { warning: false, type: null, percentage: 0 };
  }

  /**
   * 重置使用量（如果需要）
   */
  private resetIfNeeded(): void {
    const currentHour = this.getCurrentHour();
    const currentMinute = this.getCurrentMinute();
    const currentMonth = this.getCurrentMonth();

    // 重置分钟数据（保留最近 5 分钟）
    if (currentMinute !== this.lastResetMinute) {
      const oldMinute = this.lastResetMinute;
      this.minuteUsage.forEach((_, key) => {
        if (key !== currentMinute && key < oldMinute) {
          this.minuteUsage.delete(key);
        }
      });
      this.lastResetMinute = currentMinute;
    }

    // 重置小时数据（保留最近 24 小时）
    if (currentHour !== this.lastResetHour) {
      const oldHour = this.lastResetHour;
      this.hourlyUsage.forEach((_, key) => {
        if (key !== currentHour && key < oldHour - 24) {
          this.hourlyUsage.delete(key);
        }
      });
      this.lastResetHour = currentHour;
    }

    // 重置月度数据
    if (currentMonth !== this.lastResetMonth) {
      this.monthlyUsage = 0;
      this.lastResetMonth = currentMonth;
    }
  }

  private getCurrentHour(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
  }

  private getCurrentMinute(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).getTime();
  }

  private getCurrentMonth(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth()).getTime();
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 估算成本
   */
  static estimateCost(modelId: string, usage: TokenUsage): number {
    const modelCost = MODEL_COSTS[modelId] ?? { inputCost: 0.5, outputCost: 1.0 };
    return (
      (usage.promptTokens / 1_000_000) * modelCost.inputCost +
      (usage.completionTokens / 1_000_000) * modelCost.outputCost
    );
  }

  /**
   * 获取模型成本
   */
  static getModelCost(modelId: string): ModelCost {
    return MODEL_COSTS[modelId] ?? { inputCost: 0.5, outputCost: 1.0 };
  }

  /**
   * 列出所有模型的成本
   */
  static listModelCosts(): Array<{ modelId: string; cost: ModelCost }> {
    return Object.entries(MODEL_COSTS).map(([modelId, cost]) => ({ modelId, cost }));
  }
}

// 全局单例
const GLOBAL_KEY = '__novel2screenplay_budget_controller__';

export function getBudgetController(): BudgetController {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
      (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new BudgetController();
    }
    return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as BudgetController;
  }
  return new BudgetController();
}

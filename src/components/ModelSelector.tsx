'use client';

import { useState, useEffect } from 'react';

interface ModelInfo {
  modelId: string;
  cost: { input: number; output: number };
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
}

interface AdapterInfo {
  adapterId: string;
  adapterName: string;
  models: ModelInfo[];
}

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
}

/**
 * 模型选择器组件
 * 支持显示模型成本、健康状态、预算使用情况
 */
export function ModelSelector({ value, onChange, className = '' }: ModelSelectorProps) {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [budget, setBudget] = useState<{ monthly: { percentage: number; remaining: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/models');
        const data = await res.json();
        if (cancelled) return;
        if (data.adapters) {
          setAdapters(data.adapters);
        }
        if (data.budget) {
          setBudget(data.budget);
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    // 每 30 秒刷新一次
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // 获取当前模型的健康状态
  const getHealthStatus = (modelId: string) => {
    for (const adapter of adapters) {
      const model = adapter.models.find((m) => m.modelId === modelId);
      if (model) return model.health;
    }
    return 'unknown' as const;
  };

  // 获取模型成本
  const getModelCost = (modelId: string) => {
    for (const adapter of adapters) {
      const model = adapter.models.find((m) => m.modelId === modelId);
      if (model) return model.cost;
    }
    return { input: 0, output: 0 };
  };

  // 获取健康状态图标和颜色
  const getHealthIcon = (health: string) => {
    switch (health) {
      case 'healthy':
        return { icon: '●', color: 'text-green-500' };
      case 'degraded':
        return { icon: '◐', color: 'text-yellow-500' };
      case 'unhealthy':
        return { icon: '○', color: 'text-red-500' };
      default:
        return { icon: '?', color: 'text-gray-400' };
    }
  };

  if (loading) {
    return (
      <select className={`w-full border rounded-xl p-2.5 text-sm ${className}`} disabled>
        <option>加载中...</option>
      </select>
    );
  }

  const health = getHealthStatus(value);
  const cost = getModelCost(value);
  const { icon, color } = getHealthIcon(health);

  return (
    <div className={`space-y-2 ${className}`}>
      {/* 主选择器 */}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tech-input pr-16 appearance-none cursor-pointer"
        >
          {adapters.map((adapter) => (
            <optgroup key={adapter.adapterId} label={adapter.adapterName}>
              {adapter.models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.modelId}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* 下拉箭头 */}
        <svg className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>

        {/* 健康状态指示器 */}
        <div className={`absolute right-3 top-1/2 -translate-y-1/2 ${color} text-xs`}>
          {icon}
        </div>
      </div>

      {/* 展开详情 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
        type="button"
      >
        {expanded ? '▲ 收起详情' : '▼ 查看详情'}
      </button>

      {expanded && (
        <div className="bg-white/70 backdrop-blur rounded-xl border border-slate-200/70 p-3 space-y-2 text-xs">
          {/* 当前模型信息 */}
          <div className="flex justify-between items-center">
            <span className="text-slate-500">模型成本</span>
            <span className="font-mono text-slate-700">
              ¥{cost.input.toFixed(2)} / ¥{cost.output.toFixed(2)} per 1M tokens
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-500">状态</span>
            <span className={color}>
              {health === 'healthy' && '正常'}
              {health === 'degraded' && '性能下降'}
              {health === 'unhealthy' && '不可用'}
              {health === 'unknown' && '未知'}
            </span>
          </div>

          {/* 预算使用情况 */}
          {budget && (
            <div className="pt-2 border-t border-slate-100">
              <div className="flex justify-between items-center mb-1">
                <span className="text-slate-500">本月预算</span>
                <span className="text-slate-700">{(100 - budget.monthly.percentage).toFixed(1)}% 剩余</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    budget.monthly.percentage > 80
                      ? 'bg-red-500'
                      : budget.monthly.percentage > 60
                        ? 'bg-yellow-500'
                        : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(budget.monthly.percentage, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* 其他可用模型 */}
          <div className="pt-2 border-t border-slate-100">
            <p className="text-slate-500 mb-1">其他模型</p>
            <div className="space-y-1">
              {adapters.flatMap((adapter) =>
                adapter.models
                  .filter((m) => m.modelId !== value)
                  .slice(0, 3)
                  .map((model) => {
                    const { icon: mIcon, color: mColor } = getHealthIcon(model.health);
                    return (
                      <button
                        key={model.modelId}
                        onClick={() => onChange(model.modelId)}
                        className="w-full text-left px-2 py-1 rounded-lg hover:bg-indigo-50/60 flex items-center justify-between transition-colors"
                        type="button"
                      >
                        <span className="truncate text-slate-600">{model.modelId}</span>
                        <span className={mColor}>{mIcon}</span>
                      </button>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelSelector;

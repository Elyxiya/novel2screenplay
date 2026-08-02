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
      <select className={`w-full border rounded-lg p-2.5 text-sm ${className}`} disabled>
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
          className="w-full border rounded-lg p-2.5 text-sm pr-16"
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

        {/* 健康状态指示器 */}
        <div className={`absolute right-3 top-1/2 -translate-y-1/2 ${color} text-xs`}>
          {icon}
        </div>
      </div>

      {/* 展开详情 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
        type="button"
      >
        {expanded ? '▲ 收起详情' : '▼ 查看详情'}
      </button>

      {expanded && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2 text-xs">
          {/* 当前模型信息 */}
          <div className="flex justify-between items-center">
            <span className="text-gray-600">模型成本</span>
            <span className="font-mono">
              ¥{cost.input.toFixed(2)} / ¥{cost.output.toFixed(2)} per 1M tokens
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-gray-600">状态</span>
            <span className={color}>
              {health === 'healthy' && '正常'}
              {health === 'degraded' && '性能下降'}
              {health === 'unhealthy' && '不可用'}
              {health === 'unknown' && '未知'}
            </span>
          </div>

          {/* 预算使用情况 */}
          {budget && (
            <div className="pt-2 border-t">
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-600">本月预算</span>
                <span>{(100 - budget.monthly.percentage).toFixed(1)}% 剩余</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${
                    budget.monthly.percentage > 80
                      ? 'bg-red-500'
                      : budget.monthly.percentage > 60
                        ? 'bg-yellow-500'
                        : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(budget.monthly.percentage, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* 其他可用模型 */}
          <div className="pt-2 border-t">
            <p className="text-gray-600 mb-1">其他模型</p>
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
                        className="w-full text-left px-2 py-1 rounded hover:bg-gray-100 flex items-center justify-between"
                        type="button"
                      >
                        <span className="truncate">{model.modelId}</span>
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

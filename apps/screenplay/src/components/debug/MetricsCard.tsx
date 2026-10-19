'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JobMetricsSummary } from '@/lib/jobs/metrics';

/**
 * 任务指标聚合卡片（FIX-08）
 *
 * 数据源：GET /api/jobs/metrics?days=N（当前用户）。
 * 展示：成功率/耗时分位/token/预算拦截/占位率/fallback 占比/未验证内容/错误码分布。
 */

const DAY_OPTIONS = [1, 7, 30];

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

function ms(v: number | null): string {
  if (v === null) return '—';
  if (v < 1000) return `${v}ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: '10px 12px', border: '1px solid var(--border, #3333)', borderRadius: 8, minWidth: 140 }}>
      <div style={{ fontSize: 12, opacity: 0.65 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {hint ? <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{hint}</div> : null}
    </div>
  );
}

export function MetricsCard() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<JobMetricsSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/jobs/metrics?days=${d}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `请求失败 (${res.status})`);
        return;
      }
      setData((await res.json()) as JobMetricsSummary);
    } catch {
      setError('指标请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 延到微任务再触发：load 的首个动作是同步 setState（loading/error），
    // 直接在 effect 体内调用会触发级联渲染（react-hooks/set-state-in-effect）。
    let alive = true;
    queueMicrotask(() => {
      if (alive) void load(days);
    });
    return () => {
      alive = false;
    };
  }, [days, load]);

  const errorEntries = data
    ? Object.entries(data.errorCodes).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];

  return (
    <section style={{ border: '1px solid var(--border, #3333)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>任务指标聚合</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
                border: '1px solid var(--border, #3333)',
                background: d === days ? 'var(--accent, #2563eb)' : 'transparent',
                color: d === days ? '#fff' : 'inherit',
              }}
            >
              近 {d} 天
            </button>
          ))}
          {loading ? <span style={{ fontSize: 12, opacity: 0.6 }}>加载中…</span> : null}
        </div>
      </div>

      {error ? <div style={{ color: '#dc2626', fontSize: 13 }}>{error}</div> : null}

      {data ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Stat label="任务数" value={String(data.totals.jobs)} hint={`完成 ${data.totals.completed} · 失败 ${data.totals.failed} · 进行中 ${data.totals.active}`} />
            <Stat label="成功率" value={pct(data.totals.successRate)} hint="完成 / (完成+失败)" />
            <Stat label="耗时 P50 / P95" value={`${ms(data.duration.p50)} / ${ms(data.duration.p95)}`} hint={`均值 ${ms(data.duration.avg)} · ${data.duration.samples} 样本`} />
            <Stat label="Token 总量" value={String(data.tokens.totalTokens)} hint={`输入 ${data.tokens.promptTokens} · 输出 ${data.tokens.completionTokens} · 调用 ${data.tokens.calls} 次`} />
            <Stat label="预算拦截" value={String(data.budgetBlocked)} hint="超限被拦的调用点" />
            <Stat label="占位率" value={pct(data.placeholder.rate)} hint={`未解析 ${data.placeholder.unresolved} / 总计 ${data.placeholder.total}`} />
            <Stat label="Fallback 切分" value={pct(data.fallback.rate)} hint={`${data.fallback.fallbackChapters} / ${data.fallback.totalChapters} 章`} />
            <Stat label="无支撑块" value={String(data.unverified.emptyRefBlocks)} hint={`空 sourceRefs / 总块 ${data.unverified.totalBlocks}`} />
            <Stat label="低置信场景" value={String(data.unverified.lowConfScenes)} hint={`无置信标注 ${data.unverified.unknownConfScenes} · 总场景 ${data.unverified.totalScenes}`} />
          </div>

          {errorEntries.length > 0 ? (
            <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
              错误码分布：{errorEntries.map(([code, n]) => `${code}×${n}`).join(' · ')}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

'use client';

import { useState, useEffect } from 'react';

/**
 * 快速统计卡片
 *
 * 数据源为 /api/jobs/history（SQLite 持久化历史，主链路 jobStore），
 * 而非已标记预留的内存队列 /api/jobs。
 * SQLite 不存储 token 统计，totalTokens 保持 0（显示 '-'）。
 */
export function QuickStats({
  className = '',
}: {
  className?: string;
}) {
  const [stats, setStats] = useState<{
    totalJobs: number;
    completedJobs: number;
    totalTokens: number;
  } | null>(null);

  useEffect(() => {
    fetch('/api/jobs/history')
      .then((r) => r.json())
      .then((d) => {
        const jobs = d.jobs || [];
        setStats({
          totalJobs: jobs.length,
          completedJobs: jobs.filter((j: { status: string }) => j.status === 'completed').length,
          totalTokens: 0,
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div className={`grid grid-cols-3 gap-3 ${className}`}>
      <StatCard label="总任务" value={stats?.totalJobs ?? '-'} />
      <StatCard label="已完成" value={stats?.completedJobs ?? '-'} />
      <StatCard
        label="Tokens"
        value={stats?.totalTokens ? `${(stats.totalTokens / 1000).toFixed(1)}k` : '-'}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card p-3 text-center glass-card-hover">
      <p className="text-2xl font-bold neon-text font-mono">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

export default QuickStats;

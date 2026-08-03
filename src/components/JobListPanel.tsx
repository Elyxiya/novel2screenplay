'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProgressBar } from './ProgressTracker';

export interface HistoryItem {
  id: string;
  jobId: string;
  title: string;
  sourceNovel?: string;
  totalScenes: number;
  totalCharacters: number;
  totalLocations: number;
  createdAt: number;
  author?: string;
}

interface JobListPanelProps {
  className?: string;
  onSelect?: (jobId: string) => void;
}

/**
 * 任务历史面板组件
 * 显示最近的转换任务历史
 */
export function JobListPanel({ className = '', onSelect }: JobListPanelProps) {
  const router = useRouter();
  const [jobs, setJobs] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'completed' | 'failed'>('all');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/jobs');
        const data = await res.json();
        if (cancelled) return;

        // 转换为 HistoryItem 格式
        const items: HistoryItem[] = (data.jobs || []).map((job: {
          id: string;
          output?: { yamlContent?: string };
          input?: { novelText?: string };
          createdAt: number;
          status: string;
        }) => ({
          id: job.id,
          jobId: job.id,
          title: job.output?.yamlContent
            ? extractTitle(job.output.yamlContent) || '剧本'
            : '剧本',
          sourceNovel: job.input?.novelText?.slice(0, 100),
          totalScenes: 0,
          totalCharacters: 0,
          totalLocations: 0,
          createdAt: job.createdAt,
        }));

        setJobs(items);
      } catch (error) {
        console.error('Failed to fetch jobs:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    // 每 10 秒刷新
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filteredJobs = jobs.filter((job) => {
    if (filter === 'all') return true;
    // 简单过滤
    return true;
  });

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className={`bg-white rounded-xl border p-4 space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">最近任务</h3>
        <div className="flex gap-1">
          {(['all', 'completed', 'failed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded ${
                filter === f
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {f === 'all' ? '全部' : f === 'completed' ? '已完成' : '失败'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">暂无任务</div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filteredJobs.slice(0, 10).map((job) => (
            <button
              key={job.id}
              onClick={() => {
                onSelect?.(job.jobId);
                router.push(`/result/${job.jobId}`);
              }}
              className="w-full text-left p-3 rounded-lg border hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{job.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDate(job.createdAt)}
                  </p>
                </div>
                <span className="text-gray-300">›</span>
              </div>
              {(job.totalScenes > 0 || job.totalCharacters > 0) && (
                <div className="flex gap-3 mt-2 text-xs text-gray-500">
                  {job.totalScenes > 0 && (
                    <span>{job.totalScenes} 场景</span>
                  )}
                  {job.totalCharacters > 0 && (
                    <span>{job.totalCharacters} 角色</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => router.push('/history')}
        className="w-full text-center text-xs text-blue-600 hover:text-blue-700 py-1"
      >
        查看全部历史 ›
      </button>
    </div>
  );
}

/**
 * 任务状态徽章
 */
export function JobStatusBadge({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const config: Record<string, { label: string; color: string }> = {
    pending: { label: '等待', color: 'bg-gray-100 text-gray-600' },
    queued: { label: '排队中', color: 'bg-yellow-100 text-yellow-700' },
    running: { label: '运行中', color: 'bg-blue-100 text-blue-600' },
    completed: { label: '完成', color: 'bg-green-100 text-green-700' },
    failed: { label: '失败', color: 'bg-red-100 text-red-600' },
    cancelled: { label: '取消', color: 'bg-gray-100 text-gray-500' },
  };

  const { label, color } = config[status] || { label: status, color: 'bg-gray-100 text-gray-600' };

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color} ${className}`}>
      {label}
    </span>
  );
}

/**
 * 快速统计卡片
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
    fetch('/api/jobs')
      .then((r) => r.json())
      .then((d) => {
        const jobs = d.jobs || [];
        setStats({
          totalJobs: jobs.length,
          completedJobs: jobs.filter((j: { status: string }) => j.status === 'completed').length,
          totalTokens: jobs.reduce(
            (sum: number, j: { tokenUsage?: { total: number } }) => sum + (j.tokenUsage?.total || 0),
            0
          ),
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

function extractTitle(yaml: string): string | undefined {
  const match = yaml.match(/title:\s*["']?([^"'\n]+)["']?/i);
  return match?.[1]?.trim();
}

export default JobListPanel;

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { historyStore, type HistoryEntry } from '@/lib/store/history-store';
import { RequireAuth } from '@/components/RequireAuth';

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function HistoryPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<HistoryEntry[]>(() => historyStore.list());
  const [confirmClear, setConfirmClear] = useState(false);

  const remove = (jobId: string) => {
    historyStore.remove(jobId);
    setEntries(historyStore.list());
  };

  const clearAll = () => {
    historyStore.clear();
    setEntries([]);
    setConfirmClear(false);
  };

  return (
    <RequireAuth>
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">转换历史</h2>
          <p className="text-gray-500 text-sm mt-1">最近 50 条记录，跨刷新页持久保存</p>
        </div>
        <div className="flex gap-2">
          {entries.length > 0 && (
            confirmClear ? (
              <>
                <button onClick={clearAll} className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700">确认清空</button>
                <button onClick={() => setConfirmClear(false)} className="px-3 py-1.5 border text-xs rounded-lg hover:bg-gray-50">取消</button>
              </>
            ) : (
              <button onClick={() => setConfirmClear(true)} className="px-3 py-1.5 border border-red-200 text-red-500 text-xs rounded-lg hover:bg-red-50">清空历史</button>
            )
          )}
        </div>
      </div>

      {/* List */}
      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-500">暂无转换记录</p>
          <button onClick={() => router.push('/upload')} className="mt-4 px-6 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            去转换一本小说
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b text-left">
                <th className="px-4 py-3 font-medium text-gray-500 text-xs">剧本名称</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs">统计</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs w-24">创建时间</th>
                <th className="px-4 py-3 font-medium text-gray-500 text-xs w-20">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map(entry => (
                <tr key={entry.jobId} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => router.push(`/result/${entry.jobId}`)}
                      className="text-left hover:text-blue-600 font-medium"
                    >
                      {entry.title}
                    </button>
                    {entry.author && <p className="text-xs text-gray-400">{entry.author}</p>}
                    {entry.sourceNovel && <p className="text-xs text-gray-400 truncate max-w-xs">来源: {entry.sourceNovel}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    <span className="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1">{entry.totalScenes} 场景</span>
                    <span className="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1">{entry.totalCharacters} 角色</span>
                    <span className="inline-block bg-gray-100 rounded px-1.5 py-0.5">{entry.totalLocations} 地点</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">{formatDate(entry.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => router.push(`/result/${entry.jobId}`)}
                        className="text-xs border rounded px-2 py-1 hover:bg-blue-50 hover:text-blue-600"
                      >
                        查看
                      </button>
                      <button
                        onClick={() => remove(entry.jobId)}
                        className="text-xs text-red-500 border border-red-200 rounded px-2 py-1 hover:bg-red-50"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        注：记录仅保存在本浏览器中，清除浏览器数据将导致历史丢失。完整剧本数据在服务内存中，重启服务后可通过 YAML 重新导入。
      </p>
    </div>
    </RequireAuth>
  );
}

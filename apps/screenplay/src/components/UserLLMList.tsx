'use client';

import { useCallback, useEffect, useState } from 'react';

export interface UserLLMRecordView {
  id: string;
  protocol: 'openai' | 'anthropic';
  name: string;
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  defaultModel: string;
  supportedModels: string[];
  contextWindow: number;
  createdAt: number;
  updatedAt: number;
}

interface Props {
  onRefresh: () => void;
}

export default function UserLLMList({ onRefresh }: Props) {
  const [providers, setProviders] = useState<UserLLMRecordView[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMsgs, setTestMsgs] = useState<Record<string, { type: 'ok' | 'err'; text: string }>>({});

  const load = useCallback(() => {
    fetch('/api/llm')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '加载失败');
        return data;
      })
      .then((data) => {
        setProviders(data.providers ?? []);
        setMsg(null);
      })
      .catch((e) => setMsg({ type: 'err', text: (e as Error).message }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`确认删除「${name}」？此操作不可撤销。`)) return;
    const res = await fetch(`/api/llm/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setMsg({ type: 'err', text: data.error || '删除失败' });
      return;
    }
    setMsg({ type: 'ok', text: '已删除' });
    load();
    onRefresh();
  };

  const testConn = async (p: UserLLMRecordView) => {
    setTestingId(p.id);
    setTestMsgs((m) => ({ ...m, [p.id]: { type: 'err', text: '正在测试…' } }));
    try {
      const res = await fetch(`/api/llm/${p.id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestMsgs((m) => ({
        ...m,
        [p.id]: {
          type: res.ok ? 'ok' : 'err',
          text: data.message || (res.ok ? '连接正常' : '连接失败'),
        },
      }));
    } catch {
      setTestMsgs((m) => ({ ...m, [p.id]: { type: 'err', text: '网络错误，测试失败' } }));
    } finally {
      setTestingId(null);
    }
  };

  const protocolLabel = (p: 'openai' | 'anthropic') =>
    p === 'openai' ? 'OpenAI 兼容' : 'Anthropic';

  const testMsgFor = (id: string) => testMsgs[id];

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="h-16 bg-slate-100 animate-pulse rounded-xl" />
      ) : providers.length === 0 ? (
        <p className="text-sm text-slate-500 py-4">尚未导入自定义 LLM。导入后可在生成时优先使用你配置的模型。</p>
      ) : (
        providers.map((p) => {
          const tm = testMsgFor(p.id);
          return (
            <div key={p.id} className="py-3 border-b border-slate-100">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{p.name || p.defaultModel}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.protocol === 'openai' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'}`}>
                      {protocolLabel(p.protocol)}
                    </span>
                    {p.hasApiKey ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">已配置密钥</span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">无密钥</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate" title={p.baseUrl}>
                    {p.baseUrl} · 默认模型：{p.defaultModel}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => testConn(p)}
                    disabled={testingId === p.id}
                    className="px-2.5 py-1 rounded-lg text-xs text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  >
                    {testingId === p.id ? '测试中…' : (tm?.type === 'ok' ? '已连通' : '测试连接')}
                  </button>
                  <button
                    onClick={() => remove(p.id, p.name)}
                    className="px-2.5 py-1 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors"
                  >
                    删除
                  </button>
                </div>
              </div>
              {tm && (
                <div className={`mt-2 text-xs ${tm.type === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tm.text}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
'use client';

import { useState } from 'react';

interface Props {
  onCreated: () => void;
}

const inputCls =
  'w-full px-4 py-2.5 rounded-xl border border-slate-300 bg-white/80 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:border-transparent transition-all';

interface FormState {
  protocol: 'openai' | 'anthropic';
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  supportedModels: string;
  contextWindow: string;
}

const empty: FormState = {
  protocol: 'openai',
  name: '',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
  supportedModels: '',
  contextWindow: '128000',
};

export default function CustomLLMForm({ onCreated }: Props) {
  const [form, setForm] = useState<FormState>(empty);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const set = (key: keyof FormState, value: string | 'openai' | 'anthropic') =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!form.baseUrl.trim()) {
      setMsg({ type: 'err', text: 'baseUrl 不能为空' });
      return;
    }
    if (!form.defaultModel.trim()) {
      setMsg({ type: 'err', text: '默认模型不能为空' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protocol: form.protocol,
          name: form.name || undefined,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey || undefined,
          defaultModel: form.defaultModel,
          supportedModels: form.supportedModels || undefined,
          contextWindow: Number(form.contextWindow) || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: 'err', text: data.error || '导入失败' });
        return;
      }
      setMsg({ type: 'ok', text: '导入成功，已热生效' });
      setForm(empty);
      onCreated();
    } catch {
      setMsg({ type: 'err', text: '网络错误，请重试' });
    } finally {
      setLoading(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 shadow-lg shadow-indigo-300/40 hover:shadow-xl hover:shadow-indigo-300/60 transition-all duration-300"
      >
        + 导入自定义 LLM
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 border border-slate-200 rounded-2xl p-5 bg-slate-50/60">
      {/* 协议 */}
      <div className="flex gap-2">
        {(['openai', 'anthropic'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set('protocol', p)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
              form.protocol === p
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400'
            }`}
          >
            {p === 'openai' ? 'OpenAI 兼容' : 'Anthropic 原生'}
          </button>
        ))}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">显示名称（可选）</label>
        <input
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          className={inputCls}
          placeholder="如：我的 DeepSeek"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">Base URL *</label>
        <input
          value={form.baseUrl}
          onChange={(e) => set('baseUrl', e.target.value)}
          className={inputCls}
          placeholder={form.protocol === 'openai' ? 'https://api.deepseek.com/v1 或 http://localhost:11434/v1' : 'https://api.anthropic.com'}
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">API Key（本地服务可留空）</label>
        <input
          type="password"
          value={form.apiKey}
          onChange={(e) => set('apiKey', e.target.value)}
          className={inputCls}
          autoComplete="off"
          placeholder="sk-..."
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">默认模型 *</label>
        <input
          value={form.defaultModel}
          onChange={(e) => set('defaultModel', e.target.value)}
          className={inputCls}
          placeholder="如：deepseek-chat / claude-3-5-sonnet"
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">
          支持模型（逗号分隔，可留空=仅默认模型）
        </label>
        <input
          value={form.supportedModels}
          onChange={(e) => set('supportedModels', e.target.value)}
          className={inputCls}
          placeholder="如：deepseek-chat, deepseek-reasoner"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1.5">上下文窗口（token）</label>
        <input
          type="number"
          value={form.contextWindow}
          onChange={(e) => set('contextWindow', e.target.value)}
          className={inputCls}
        />
      </div>

      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm ${msg.type === 'ok' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-red-50 border border-red-200 text-red-600'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-500 shadow-lg shadow-indigo-300/40 hover:shadow-xl hover:shadow-indigo-300/60 transition-all duration-300 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          保存导入
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setMsg(null);
          }}
          className="px-4 py-3 rounded-xl text-sm text-slate-500 hover:bg-slate-100 transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  );
}
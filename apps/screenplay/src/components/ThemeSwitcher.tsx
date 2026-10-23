'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const THEME_KEY = 'n2s-theme';
const DEFAULT_THEME = 'amber';

const THEMES: { id: string; label: string; desc: string; color: string }[] = [
  { id: 'amber', label: '影院琥珀', desc: '默认 · 钨丝暖光', color: '#e8b04a' },
  { id: 'teal', label: '冷调片场', desc: '管线青 · 冷光', color: '#22d3ee' },
  { id: 'violet', label: '深夜霓虹', desc: '靛紫 · 片场夜拍', color: '#a78bfa' },
  { id: 'emerald', label: '翡翠剪辑', desc: '绿幕 · 剪辑台', color: '#34d399' },
];

// 主题作为外部系统（localStorage + <html data-theme>）的镜像，用 useSyncExternalStore 订阅。
// getServerSnapshot 返回默认值保证 SSR 与首帧 hydration 一致，避免闪烁与 hydration mismatch。
let currentTheme: string = DEFAULT_THEME;
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved && THEMES.some(t => t.id === saved)) currentTheme = saved;
}
const themeListeners = new Set<() => void>();
function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  return () => { themeListeners.delete(cb); };
}
function getSnapshotTheme(): string {
  return currentTheme;
}
function getServerSnapshotTheme(): string {
  return DEFAULT_THEME;
}
function setThemeStore(id: string) {
  currentTheme = id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // localStorage 不可用（隐私模式）时静默降级，仅应用一次
  }
  document.documentElement.dataset.theme = id;
  themeListeners.forEach(cb => cb());
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribeTheme, getSnapshotTheme, getServerSnapshotTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const apply = (id: string) => {
    setThemeStore(id);
    setOpen(false);
  };

  // 点击外部关闭
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const current = THEMES.find(t => t.id === theme) ?? THEMES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-white/10 bg-white/4 text-ink-muted hover:text-white hover:border-white/20 transition-all duration-300"
        title="主题切换"
        aria-label="切换主题配色"
      >
        <span className="w-4 h-4 rounded-full ring-2 ring-white/20" style={{ backgroundColor: current.color }} />
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a20]/95 backdrop-blur-xl shadow-2xl p-1.5 z-50">
          <p className="px-2.5 py-1.5 text-[11px] font-semibold text-ink-faint tracking-wider">主题配色</p>
          {THEMES.map(t => {
            const isActive = t.id === theme;
            return (
              <button
                key={t.id}
                onClick={() => apply(t.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                  isActive ? 'bg-white/8' : 'hover:bg-white/5'
                }`}
              >
                <span className="w-4 h-4 rounded-full shrink-0 ring-2 ring-white/15" style={{ backgroundColor: t.color }} />
                <span className="min-w-0">
                  <span className={`block text-sm leading-tight ${isActive ? 'text-white' : 'text-ink-text'}`}>{t.label}</span>
                  <span className="block text-[11px] text-ink-faint leading-tight mt-0.5">{t.desc}</span>
                </span>
                {isActive && (
                  <svg className="w-4 h-4 ml-auto text-teal-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
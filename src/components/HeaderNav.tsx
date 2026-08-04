'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HistoryPanel } from '@/components/HistoryPanel';
import { WorkflowStepper, getStepFromPath } from '@/components/WorkflowStepper';
import { AuthStatus } from '@/components/AuthStatus';

export function HeaderNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [showHistory, setShowHistory] = useState(false);
  const isResultPage = pathname?.startsWith('/result/');
  const isDebugPage = pathname?.startsWith('/debug');
  const isWorkbenchPage = pathname === '/workbench';
  const isShortdramaPage = pathname?.startsWith('/shortdrama');
  const currentStep = getStepFromPath(pathname ?? '');
  // 站点导航页（首页/功能介绍/使用指南）：不显示转换步进器，改为显示站点导航
  const isLandingPage = pathname === '/' || pathname === '/features' || pathname === '/guide';
  const showStepper = !isDebugPage && !isWorkbenchPage && !isShortdramaPage && !isLandingPage;
  const showSiteNav = !showStepper && !isDebugPage;

  const SITE_LINKS = [
    { href: '/', label: '首页', icon: 'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10' },
    { href: '/features', label: '功能介绍', icon: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm7 14V9m0 0V7m0 2v2' },
    { href: '/guide', label: '使用指南', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  ];

  return (
    <>
      <header className="shrink-0 relative z-50 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center gap-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <span className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-400 text-white shadow-lg shadow-indigo-300/50 transition-transform duration-300 group-hover:scale-105">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6M9 17h4" />
              </svg>
              {/* 呼吸光点 */}
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan-300 animate-pulse" />
            </span>
            <span className="hidden md:flex flex-col leading-tight">
              <span className="text-base font-bold tracking-tight neon-text">Novel2Screenplay</span>
              <span className="text-[10px] text-slate-400 tracking-widest">小说 → 剧本 · AI 工作台</span>
            </span>
          </Link>

          {/* 3 步向导导航 */}
          {showStepper && (
            <div className="flex-1 min-w-0 max-w-2xl mx-auto px-2">
              <WorkflowStepper
                current={currentStep}
                completed={isResultPage}
                className="py-1"
              />
            </div>
          )}

          {/* 站点导航（首页 / 功能介绍 / 使用指南） */}
          {showSiteNav && (
            <nav className="flex-1 min-w-0 max-w-xl mx-auto px-2 hidden sm:flex items-center justify-center gap-1">
              {SITE_LINKS.map((l) => {
                const active = pathname === l.href;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`px-3.5 py-2 rounded-xl text-sm flex items-center gap-1.5 transition-all duration-300 ${
                      active
                        ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-300/40'
                        : 'text-slate-500 hover:bg-white/70 hover:text-slate-800 hover:shadow-sm'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={l.icon} />
                    </svg>
                    {l.label}
                  </Link>
                );
              })}
            </nav>
          )}

          {/* 工作台 + 短剧分镜 + 历史 */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <Link
              href="/shortdrama"
              prefetch={false}
              className={`px-3.5 py-2 rounded-xl text-sm flex items-center gap-2 transition-all duration-300 border ${
                pathname?.startsWith('/shortdrama')
                  ? 'bg-gradient-to-r from-teal-600 to-indigo-600 text-white border-transparent shadow-lg shadow-teal-300/50'
                  : 'border-slate-300 bg-white/70 text-slate-500 hover:border-teal-400/60 hover:text-slate-800 hover:shadow-md hover:shadow-teal-100/60'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <rect x="2" y="4" width="20" height="16" rx="3" />
                <path d="M10 9l5 3-5 3V9z" />
              </svg>
              <span className="hidden sm:inline">短剧分镜</span>
            </Link>
            <Link
              href="/workbench"
              className={`px-3.5 py-2 rounded-xl text-sm flex items-center gap-2 transition-all duration-300 border ${
                isWorkbenchPage
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white border-transparent shadow-lg shadow-indigo-300/50'
                  : 'border-slate-300 bg-white/70 text-slate-500 hover:border-cyan-400/60 hover:text-slate-800 hover:shadow-md hover:shadow-cyan-100/60'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="hidden sm:inline">工作台</span>
            </Link>
            <button
              onClick={() => setShowHistory(v => !v)}
              className={`px-3.5 py-2 rounded-xl text-sm flex items-center gap-2 transition-all duration-300 border ${
                showHistory
                  ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 text-white border-transparent shadow-lg shadow-indigo-300/50'
                  : 'border-slate-300 bg-white/70 text-slate-500 hover:border-cyan-400/60 hover:text-slate-800 hover:shadow-md hover:shadow-cyan-100/60'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="hidden sm:inline">历史</span>
            </button>

            {/* 用户状态：登录/注册 或 用户菜单 */}
            <AuthStatus />
          </div>
        </div>
      </header>

      {isResultPage ? (
        <div className="flex-1 flex flex-col">
          {children}
        </div>
      ) : (
        <div className={`flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto flex flex-col transition-all duration-300 ${showHistory ? 'pr-[304px]' : ''}`}>
          {children}
        </div>
      )}

      {showHistory && (
        <>
          {!isResultPage && (
            <div
              className="fixed inset-0 bg-slate-900/20 backdrop-blur-[2px] z-40"
              onClick={() => setShowHistory(false)}
            />
          )}
          <div className="fixed top-[61px] right-0 h-[calc(100vh-61px)] w-72 bg-white/90 backdrop-blur-xl border-l border-slate-200/70 shadow-2xl flex flex-col z-40 p-3">
            <HistoryPanel />
          </div>
        </>
      )}
    </>
  );
}

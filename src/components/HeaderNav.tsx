'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HistoryPanel } from '@/components/HistoryPanel';

const NAV_ITEMS = [
  { href: '/', label: '上传' },
  { href: '/configure', label: '配置' },
  { href: '/convert', label: '转换' },
];

export function HeaderNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [showHistory, setShowHistory] = useState(false);
  const isResultPage = pathname?.startsWith('/result/');

  return (
    <>
      <header className="border-b bg-white px-6 py-3 flex items-center gap-3 shrink-0 relative z-50">
        <Link href="/" className="text-lg font-bold tracking-tight hover:text-blue-600 transition-colors">
          Novel2Screenplay
        </Link>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">小说转剧本</span>
        <nav className="flex items-center gap-1 ml-4">
          {NAV_ITEMS.map((item, i) => (
            <span key={item.href} className="flex items-center gap-1">
              {i > 0 && <span className="text-gray-300 text-xs">›</span>}
              <Link
                href={item.href}
                className={`text-sm transition-colors px-1.5 py-0.5 rounded ${
                  pathname === item.href
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-500 hover:text-blue-600 hover:bg-gray-50'
                }`}
              >
                {item.label}
              </Link>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center">
          <button
            onClick={() => setShowHistory(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 border transition-colors ${
              showHistory
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            历史
          </button>
        </div>
      </header>

      <div className={`flex-1 p-4 max-w-[1600px] w-full mx-auto flex flex-col transition-all duration-300`}>
        <div className={showHistory && !isResultPage ? 'pr-[304px]' : ''}>
          {children}
        </div>
      </div>

      {showHistory && (
        <>
          {!isResultPage && (
            <div
              className="fixed inset-0 bg-black/10 z-40"
              onClick={() => setShowHistory(false)}
            />
          )}
          <div className="fixed top-[49px] right-0 h-[calc(100vh-49px)] w-72 bg-white border-l shadow-xl flex flex-col z-40">
            <HistoryPanel />
          </div>
        </>
      )}
    </>
  );
}

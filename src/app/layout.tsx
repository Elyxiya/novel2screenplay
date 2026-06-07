import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel2Screenplay - 小说转剧本',
  description: 'AI 辅助剧本创作工具，将小说文本自动转换为结构化剧本',
};

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: '上传' },
  { href: '/configure', label: '配置' },
  { href: '/convert', label: '转换' },
];

function BreadcrumbNav() {
  return (
    <header className="border-b bg-white px-6 py-3 flex items-center gap-3 shrink-0">
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
              className="text-sm text-gray-500 hover:text-blue-600 transition-colors px-1.5 py-0.5 rounded hover:bg-gray-50"
            >
              {item.label}
            </Link>
          </span>
        ))}
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <BreadcrumbNav />
        <main className="flex-1 p-6 max-w-6xl w-full mx-auto">{children}</main>
      </body>
    </html>
  );
}

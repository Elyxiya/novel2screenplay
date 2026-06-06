import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel2Screenplay - 小说转剧本',
  description: 'AI 辅助剧本创作工具，将小说文本自动转换为结构化剧本',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900">
        <header className="border-b bg-white px-6 py-3 flex items-center gap-3 shrink-0">
          <h1 className="text-lg font-bold tracking-tight">Novel2Screenplay</h1>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">小说转剧本</span>
        </header>
        <main className="flex-1 p-6 max-w-6xl w-full mx-auto">{children}</main>
      </body>
    </html>
  );
}

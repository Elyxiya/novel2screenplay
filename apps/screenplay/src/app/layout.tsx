import type { Metadata } from 'next';
import { HeaderNav } from '@/components/HeaderNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel2Screenplay - 小说转剧本',
  description: 'AI 辅助剧本创作工具，将小说文本自动转换为结构化剧本',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased" data-theme="light">
      <body className="h-full flex flex-col text-slate-800">
        <HeaderNav>{children}</HeaderNav>
      </body>
    </html>
  );
}

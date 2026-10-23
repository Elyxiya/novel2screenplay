import type { Metadata } from 'next';
import { HeaderNav } from '@/components/HeaderNav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel2Screenplay - 小说转剧本',
  description: 'AI 辅助剧本创作工具，将小说文本自动转换为结构化剧本',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased" data-theme="amber" style={{ backgroundColor: '#0b0b0d' }}>
      <head>
        {/* 防闪烁：首帧前用 localStorage 恢复用户主题 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('n2s-theme')||'amber';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','amber');}`,
          }}
        />
      </head>
      <body className="h-full flex flex-col text-ink-text bg-ink">
        <HeaderNav>{children}</HeaderNav>
      </body>
    </html>
  );
}

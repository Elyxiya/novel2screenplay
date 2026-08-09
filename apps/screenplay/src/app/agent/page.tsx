import { RequireAuth } from '@/components/RequireAuth';
import { AgentChatPanel } from '@/components/agent/AgentChatPanel';

export const metadata = {
  title: 'Agent 对话工作台 · Novel2Screenplay',
  description: '用自然语言指导 AI Agent 完成小说到剧本的四阶段转换',
};

export default function AgentPage() {
  return (
    <RequireAuth>
      <div className="h-[calc(100vh-61px)]">
        <AgentChatPanel />
      </div>
    </RequireAuth>
  );
}

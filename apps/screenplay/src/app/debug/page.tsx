import { Suspense } from 'react';
import { RequireAuth } from '@/components/RequireAuth';
import { FlowDebugClient } from '@/components/debug/FlowDebugClient';

export const metadata = {
  title: '流程调试与评测',
  description: '查看转换管线的各阶段产物与效果评测',
};

export default function DebugPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div style={{ padding: 24 }}>加载中...</div>}>
        <FlowDebugClient />
      </Suspense>
    </RequireAuth>
  );
}

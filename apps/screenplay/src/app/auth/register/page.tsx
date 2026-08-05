'use client';

import { Suspense } from 'react';

import { AuthForm } from '@/components/AuthForm';

export default function RegisterPage() {
  return (
    <div className="min-h-full flex items-center justify-center py-10">
      <Suspense fallback={<div className="text-slate-400">加载中...</div>}>
        <AuthForm mode="register" />
      </Suspense>
    </div>
  );
}

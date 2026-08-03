'use client';

import { AuthForm } from '@/components/AuthForm';

export default function RegisterPage() {
  return (
    <div className="min-h-full flex items-center justify-center py-10">
      <AuthForm mode="register" />
    </div>
  );
}

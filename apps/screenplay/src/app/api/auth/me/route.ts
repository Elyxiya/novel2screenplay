import { NextResponse } from 'next/server';
import { getCurrentPublicUser, authError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** GET /api/auth/me - 获取当前登录用户 */
export async function GET() {
  const user = await getCurrentPublicUser();
  if (!user) return authError('未登录');
  return NextResponse.json({ user });
}

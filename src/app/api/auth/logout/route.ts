import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout - 登出（销毁会话并清除 Cookie） */
export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ success: true, message: '已退出登录' });
  } catch {
    // 会话不存在也视为登出成功
    return NextResponse.json({ success: true });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';
import { getUserRepository } from '@/lib/store/sqlite';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  // 支持用户名或邮箱登录
  username: z.string().min(1, '请输入用户名或邮箱'),
  password: z.string().min(1, '请输入密码'),
});

/** POST /api/auth/login - 登录 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    const { username, password } = parsed.data;
    const repo = getUserRepository();

    // 统一错误信息，避免用户名枚举
    const user = repo.getByUsername(username) ?? (username.includes('@') ? repo.getByEmail(username) : null);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const token = createSession(user.id);
    await setSessionCookie(token);

    return NextResponse.json({
      message: '登录成功',
      user: repo.toPublic(user),
    });
  } catch {
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword, createSession, setSessionCookie } from '@/lib/auth';
import { getUserRepository } from '@/lib/store/sqlite';

export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  username: z
    .string()
    .min(3, '用户名至少 3 个字符')
    .max(20, '用户名最多 20 个字符')
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, '用户名只能包含字母、数字、下划线或中文'),
  email: z.string().email('邮箱格式不正确').max(100).optional().or(z.literal('')),
  password: z.string().min(6, '密码至少 6 位').max(72, '密码最多 72 位'),
});

/** POST /api/auth/register - 注册并自动登录 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    const { username, password } = parsed.data;
    const email = parsed.data.email || undefined;

    const repo = getUserRepository();

    if (repo.getByUsername(username)) {
      return NextResponse.json({ error: '用户名已被占用' }, { status: 409 });
    }
    if (email) {
      const byEmail = repo.getByEmail(email);
      if (byEmail) {
        return NextResponse.json({ error: '邮箱已被注册' }, { status: 409 });
      }
    }

    const passwordHash = await hashPassword(password);
    const userId = repo.create({ username, email, passwordHash });
    const user = repo.getById(userId)!;

    // 注册即登录
    const token = createSession(userId);
    await setSessionCookie(token);

    return NextResponse.json({
      message: '注册成功',
      user: repo.toPublic(user),
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}

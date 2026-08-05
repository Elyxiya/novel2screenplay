import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, authError, hashPassword, verifyPassword } from '@/lib/auth';
import { getUserRepository } from '@/lib/store/sqlite';

export const dynamic = 'force-dynamic';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码'),
  newPassword: z.string().min(6, '新密码至少 6 位').max(72, '新密码最多 72 位'),
});

/** PATCH /api/auth/password - 修改密码 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const body = await request.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    const repo = getUserRepository();
    const stored = repo.getById(user.id);
    if (!stored) return authError('账户不存在', 404);

    if (!(await verifyPassword(parsed.data.currentPassword, stored.passwordHash))) {
      return NextResponse.json({ error: '当前密码错误' }, { status: 401 });
    }

    const newHash = await hashPassword(parsed.data.newPassword);
    repo.updatePassword(user.id, newHash);

    return NextResponse.json({ success: true, message: '密码修改成功' });
  } catch {
    return NextResponse.json({ error: '修改失败，请稍后重试' }, { status: 500 });
  }
}

/**
 * UserLLM API - 连通性测试
 *
 * POST /api/llm/[id]/test  - 对指定用户自定义 LLM 发起一次最小请求，验证连通性。
 * owner 校验：非本人返回 404，不泄露存在性。
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { getUserLLMRepository } from '@/lib/store/sqlite';
import { testUserLLMConnection } from '@/lib/llm/user-llm-connectivity';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { id } = await params;
    const repo = getUserLLMRepository();
    const record = repo.getById(id);
    if (!record || record.userId !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await testUserLLMConnection(record);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
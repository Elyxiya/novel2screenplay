import { NextRequest, NextResponse } from 'next/server';
import { getDramaRepository } from '@/lib/store/sqlite/drama-repository';
import { safeParseDramaFromYaml } from '@novel/contracts/serializers';
import { getCurrentUser, authError } from '@novel/auth';

export const dynamic = 'force-dynamic';

/** 校验用户是否有权访问该分镜；返回 record 或 null（已写入响应） */
async function resolveOwnedDrama(id: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, record: null };

  const repo = getDramaRepository();
  const record = repo.get(id);
  if (!record) return { user, record: null };
  if (record.userId && record.userId !== user.id) return { user, record: null };
  return { user, record };
}

/** GET /api/drama/[id] - 分镜详情（含 YAML 与溯源信息） */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, record } = await resolveOwnedDrama(id);
    if (!user) return authError();
    if (!record) return NextResponse.json({ error: '分镜不存在' }, { status: 404 });

    return NextResponse.json({
      id: record.id,
      title: record.title,
      yaml: record.dramaYaml,
      sourceJobId: record.sourceJobId,
      sourceNovelId: record.sourceNovelId,
      createdAt: record.createdAt,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** PATCH /api/drama/[id] - 更新分镜标题 / 分镜 YAML */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, record } = await resolveOwnedDrama(id);
    if (!user) return authError();
    if (!record) return NextResponse.json({ error: '分镜不存在' }, { status: 404 });

    const body = (await req.json()) as { title?: unknown; yaml?: unknown };
    const repo = getDramaRepository();

    const title = typeof body.title === 'string' ? body.title.trim() : undefined;
    if (title !== undefined && title.length === 0) {
      return NextResponse.json({ error: '标题不能为空' }, { status: 400 });
    }
    if (title !== undefined && title.length > 100) {
      return NextResponse.json({ error: '标题过长（最多 100 字）' }, { status: 400 });
    }

    let yaml: string | undefined;
    if (body.yaml !== undefined) {
      if (typeof body.yaml !== 'string' || body.yaml.trim().length === 0) {
        return NextResponse.json({ error: '分镜 YAML 不能为空' }, { status: 400 });
      }
      // 提交前校验 YAML 可解析且为合法 Drama 结构
      const parsed = safeParseDramaFromYaml(body.yaml);
      if (!parsed.success) {
        return NextResponse.json({ error: `分镜 YAML 校验失败: ${parsed.error}` }, { status: 400 });
      }
      yaml = body.yaml;
    }

    repo.update(id, { title, dramaYaml: yaml });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE /api/drama/[id] - 删除分镜 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, record } = await resolveOwnedDrama(id);
    if (!user) return authError();
    if (!record) return NextResponse.json({ error: '分镜不存在' }, { status: 404 });

    getDramaRepository().delete(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

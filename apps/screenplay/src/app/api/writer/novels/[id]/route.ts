/**
 * Writer Novel Detail API
 *
 * GET    /api/writer/novels/[id] - 详情（含卷/章/人物/世界观）
 * PATCH  /api/writer/novels/[id] - 更新元信息/卷结构/人物卡/世界观
 * DELETE /api/writer/novels/[id] - 删除创作小说
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWriterNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@/lib/auth';
import { VolumeSchema, CharacterCardSchema, WorldItemSchema } from '@/lib/schema/novel.schema';
import type { z } from 'zod';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** 鉴权 + 归属校验，返回错误响应或 null */
async function authorize(id: string): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return authError();
  const repo = getWriterNovelRepository();
  const draft = repo.getDraft(id);
  if (!draft) return NextResponse.json({ error: '创作小说不存在' }, { status: 404 });
  if (draft.userId !== user.id) {
    return NextResponse.json({ error: '无权访问该小说' }, { status: 403 });
  }
  return null;
}

/** GET /api/writer/novels/[id] */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  const repo = getWriterNovelRepository();
  const draft = repo.getDraft(id);
  return NextResponse.json({ novel: draft });
}

/** PATCH /api/writer/novels/[id] */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const repo = getWriterNovelRepository();

  // 元信息
  if (body.meta !== undefined) {
    const meta = body.meta as { title?: unknown; author?: unknown; synopsis?: unknown };
    if (meta.title !== undefined && typeof meta.title !== 'string') {
      return NextResponse.json({ error: 'title 必须是字符串' }, { status: 400 });
    }
    repo.updateMeta(id, {
      title: meta.title !== undefined ? meta.title : undefined,
      author: meta.author !== undefined ? String(meta.author) : undefined,
      synopsis: meta.synopsis !== undefined ? String(meta.synopsis) : undefined,
    });
  }

  // 卷结构
  if (body.volumes !== undefined) {
    const parsed = parseArray(body.volumes, VolumeSchema);
    if (!parsed.ok) return parsed.res;
    repo.saveStructure(id, { volumes: parsed.value });
  }

  // 人物卡
  if (body.characters !== undefined) {
    const parsed = parseArray(body.characters, CharacterCardSchema);
    if (!parsed.ok) return parsed.res;
    repo.saveStructure(id, { characters: parsed.value });
  }

  // 世界观
  if (body.worldItems !== undefined) {
    const parsed = parseArray(body.worldItems, WorldItemSchema);
    if (!parsed.ok) return parsed.res;
    repo.saveStructure(id, { worldItems: parsed.value });
  }

  const draft = repo.getDraft(id);
  return NextResponse.json({ novel: draft });
}

/** DELETE /api/writer/novels/[id] */
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const denied = await authorize(id);
  if (denied) return denied;

  const repo = getWriterNovelRepository();
  repo.delete(id);
  return NextResponse.json({ success: true });
}

function parseArray<T>(value: unknown, schema: z.ZodType<T>) {
  if (!Array.isArray(value)) {
    return { ok: false as const, res: NextResponse.json({ error: '必须是数组' }, { status: 400 }) };
  }
  const parsed: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const r = schema.safeParse(value[i]);
    if (!r.success) {
      return { ok: false as const, res: NextResponse.json({ error: `第 ${i} 项不合法: ${r.error?.issues[0]?.message ?? '校验失败'}` }, { status: 400 }) };
    }
    parsed.push(r.data);
  }
  return { ok: true as const, value: parsed };
}

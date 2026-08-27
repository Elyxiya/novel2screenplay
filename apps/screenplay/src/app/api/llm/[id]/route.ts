/**
 * UserLLM API - 单条自定义 LLM（owner 校验）
 *
 * GET    /api/llm/[id]  - 读取一条
 * PATCH  /api/llm/[id]  - 部分更新（apiKey 传空串 = 不修改密钥）
 * DELETE /api/llm/[id]  - 删除
 *
 * 均在 Repository 层校验 owner（非本人返回 404，不泄露存在性）。
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { getUserLLMRepository, type UserLLMProtocol, type UserLLMRecord } from '@/lib/store/sqlite';
import { reloadUserLLM } from '@/lib/llm/user-llm-registry';

export const dynamic = 'force-dynamic';

const VALID_PROTOCOLS: UserLLMProtocol[] = ['openai', 'anthropic'];

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}****${key.slice(-3)}`;
}

function toSafeProvider(record: UserLLMRecord) {
  return {
    id: record.id,
    protocol: record.protocol,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: maskApiKey(record.apiKey),
    hasApiKey: Boolean(record.apiKey),
    defaultModel: record.defaultModel,
    supportedModels: record.supportedModels,
    contextWindow: record.contextWindow,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function parseSupportedModels(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
}

/** 读取并对归属校验（非本人返回 null -> 404） */
async function getOwned(userId: string, id: string): Promise<UserLLMRecord | null> {
  const repo = getUserLLMRepository();
  const record = repo.getById(id);
  if (!record || record.userId !== userId) return null;
  return record;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { id } = await params;
    const record = await getOwned(user.id, id);
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ provider: toSafeProvider(record) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { id } = await params;
    const existing = await getOwned(user.id, id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体必须为 JSON' }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    if (b.protocol !== undefined && !VALID_PROTOCOLS.includes(b.protocol as UserLLMProtocol)) {
      return NextResponse.json({ error: 'protocol 必须为 openai 或 anthropic' }, { status: 400 });
    }
    if (b.baseUrl !== undefined && (typeof b.baseUrl !== 'string' || !b.baseUrl.trim())) {
      return NextResponse.json({ error: 'baseUrl 不能为空' }, { status: 400 });
    }
    if (b.defaultModel !== undefined && (typeof b.defaultModel !== 'string' || !b.defaultModel.trim())) {
      return NextResponse.json({ error: 'defaultModel 不能为空' }, { status: 400 });
    }

    const repo = getUserLLMRepository();
    const updated = repo.update(id, {
      protocol: b.protocol !== undefined ? (b.protocol as UserLLMProtocol) : undefined,
      baseUrl: typeof b.baseUrl === 'string' && b.baseUrl.trim() ? b.baseUrl.trim() : undefined,
      // apiKey 传非空串才覆盖；空串/未传 = 保持
      apiKey: typeof b.apiKey === 'string' && b.apiKey.trim() ? b.apiKey.trim() : undefined,
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : undefined,
      defaultModel: typeof b.defaultModel === 'string' && b.defaultModel.trim() ? b.defaultModel.trim() : undefined,
      supportedModels: parseSupportedModels(b.supportedModels),
      contextWindow:
        typeof b.contextWindow === 'number' && Number.isFinite(b.contextWindow)
          ? Math.floor(b.contextWindow)
          : undefined,
    });

    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    reloadUserLLM(user.id); // 热生效

    return NextResponse.json({ provider: toSafeProvider(updated) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const { id } = await params;
    const existing = await getOwned(user.id, id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const repo = getUserLLMRepository();
    repo.delete(id);
    reloadUserLLM(user.id); // 移除缓存

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
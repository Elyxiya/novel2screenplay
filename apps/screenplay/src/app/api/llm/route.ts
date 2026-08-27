/**
 * UserLLM API - 自定义 LLM 导入（用户级）
 *
 * GET  /api/llm  - 当前登录用户已导入的自定义 LLM 列表（apiKey 打码）
 * POST /api/llm  - 导入一条自定义 LLM（OpenAI 兼容 / Anthropic 原生），热注册
 */

import { NextResponse } from 'next/server';
import { getCurrentUser, authError } from '@/lib/auth';
import { getUserLLMRepository } from '@/lib/store/sqlite';
import { reloadUserLLM } from '@/lib/llm/user-llm-registry';
import type { UserLLMProtocol, UserLLMRecord } from '@/lib/store/sqlite';

export const dynamic = 'force-dynamic';

const VALID_PROTOCOLS: UserLLMProtocol[] = ['openai', 'anthropic'];

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '***';
  return `${key.slice(0, 3)}****${key.slice(-3)}`;
}

/** 返回给前端的打码安全视图 */
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

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const repo = getUserLLMRepository();
    const records = repo.listByUser(user.id).map(toSafeProvider);

    return NextResponse.json({ providers: records });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体必须为 JSON' }, { status: 400 });
    }
    const b = body as Record<string, unknown>;

    const protocol = b.protocol;
    if (!VALID_PROTOCOLS.includes(protocol as UserLLMProtocol)) {
      return NextResponse.json({ error: 'protocol 必须为 openai 或 anthropic' }, { status: 400 });
    }

    const baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : '';
    if (!baseUrl) return NextResponse.json({ error: 'baseUrl 不能为空' }, { status: 400 });

    const defaultModel = typeof b.defaultModel === 'string' ? b.defaultModel.trim() : '';
    if (!defaultModel) return NextResponse.json({ error: 'defaultModel 不能为空' }, { status: 400 });

    const repo = getUserLLMRepository();
    const provider = repo.create({
      userId: user.id,
      protocol: protocol as UserLLMProtocol,
      baseUrl,
      apiKey: typeof b.apiKey === 'string' ? b.apiKey.trim() : '',
      name: typeof b.name === 'string' && b.name.trim() ? b.name.trim() : undefined,
      defaultModel,
      supportedModels: parseSupportedModels(b.supportedModels),
      contextWindow:
        typeof b.contextWindow === 'number' && Number.isFinite(b.contextWindow)
          ? Math.floor(b.contextWindow)
          : undefined,
    });

    reloadUserLLM(user.id); // 热注册生效

    return NextResponse.json({ provider: toSafeProvider(provider) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
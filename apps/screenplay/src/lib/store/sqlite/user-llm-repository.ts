/**
 * UserLLM Repository - 用户自定义 LLM 持久化
 *
 * 为用户通过 /api/llm 导入的自定义 LLM Provider（OpenAI 兼容 / Anthropic 原生）
 * 提供按 user_id 隔离的增删改查。
 *
 * 约定：
 * - api_key 落库即 AES-GCM 密文（见 lib/llm/api-key-cipher.ts），读侧解密还原明文供运行时使用；
 *   存量明文由 db.ts migrateLegacyLLMKeys 迁移。
 * - 读侧校验 owner（getById 不校验，调用方负责）。
 * - supported_models 以 JSON array 存库。
 */

import { randomUUID } from 'crypto';
import { getDatabase } from './db';
import { decryptApiKey, encryptApiKey } from '../../llm/api-key-cipher';

export type UserLLMProtocol = 'openai' | 'anthropic';

export interface UserLLMRecord {
  id: string;
  userId: string;
  protocol: UserLLMProtocol;
  baseUrl: string;
  apiKey: string;
  name: string;
  defaultModel: string;
  supportedModels: string[];
  contextWindow: number;
  createdAt: number;
  updatedAt: number;
}

/** 创建入参：protocol/baseUrl/defaultModel 必填，其余可选 */
export interface CreateUserLLMParams {
  userId: string;
  protocol: UserLLMProtocol;
  baseUrl: string;
  apiKey?: string;
  name?: string;
  defaultModel: string;
  supportedModels?: string[];
  contextWindow?: number;
}

/** 更新入参：全可选；apiKey 传非空串才覆盖，空串 = 保持不变 */
export type UpdateUserLLMParams = Partial<
  Pick<UserLLMRecord, 'protocol' | 'baseUrl' | 'apiKey' | 'name' | 'defaultModel' | 'supportedModels' | 'contextWindow'>
>;

/** apiKey 摘要（不落地明文，仅暴露可见性，供配置页/列表展示） */
export interface UserLLMApiKeySummary {
  id: string;
  hasApiKey: boolean;
  protocol: UserLLMProtocol;
  name: string;
}

interface UserLLMRow {
  id: string;
  user_id: string;
  protocol: string;
  base_url: string;
  api_key: string;
  name: string;
  default_model: string;
  supported_models: string;
  context_window: number;
  created_at: number;
  updated_at: number;
}

export interface UserLLMRepository {
  listByUser(userId: string): UserLLMRecord[];
  getById(id: string): UserLLMRecord | null;
  create(params: CreateUserLLMParams): UserLLMRecord;
  update(id: string, patch: UpdateUserLLMParams): UserLLMRecord | null;
  delete(id: string): boolean;
  listApiKeysByUser(userId: string): UserLLMApiKeySummary[];
}

class UserLLMRepositoryImpl implements UserLLMRepository {
  listByUser(userId: string): UserLLMRecord[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM user_llm WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as UserLLMRow[];
    return rows.map((r) => this.rowToRecord(r));
  }

  getById(id: string): UserLLMRecord | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM user_llm WHERE id = ?').get(id) as
      | UserLLMRow
      | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  create(params: CreateUserLLMParams): UserLLMRecord {
    const db = getDatabase();
    const now = Date.now();
    const id = `ulm_${now}_${randomUUID().slice(0, 8)}`;
    const supportedModels = this.normalizeSupported(params);
    const record: UserLLMRecord = {
      id,
      userId: params.userId,
      protocol: params.protocol,
      baseUrl: params.baseUrl,
      apiKey: params.apiKey ?? '',
      name: params.name ?? (params.protocol === 'anthropic' ? 'Custom Anthropic' : 'Custom OpenAI'),
      defaultModel: params.defaultModel,
      supportedModels,
      contextWindow: params.contextWindow ?? 128000,
      createdAt: now,
      updatedAt: now,
    };

    db.prepare(`
      INSERT INTO user_llm
        (id, user_id, protocol, base_url, api_key, name, default_model, supported_models, context_window, created_at, updated_at)
      VALUES
        (@id, @userId, @protocol, @baseUrl, @apiKey, @name, @defaultModel, @supportedModels, @contextWindow, @createdAt, @updatedAt)
    `).run({
      id: record.id,
      userId: record.userId,
      protocol: record.protocol,
      baseUrl: record.baseUrl,
      apiKey: encryptApiKey(record.apiKey), // 落库即密文
      name: record.name,
      defaultModel: record.defaultModel,
      supportedModels: JSON.stringify(record.supportedModels),
      contextWindow: record.contextWindow,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });

    return record;
  }

  update(id: string, patch: UpdateUserLLMParams): UserLLMRecord | null {
    const db = getDatabase();
    const existing = this.getById(id);
    if (!existing) return null;

    const now = Date.now();
    const next: UserLLMRecord = {
      ...existing,
      protocol: patch.protocol ?? existing.protocol,
      baseUrl: patch.baseUrl ?? existing.baseUrl,
      // apiKey 空串 = 不修改密钥
      apiKey: patch.apiKey != null && patch.apiKey !== '' ? patch.apiKey : existing.apiKey,
      name: patch.name ?? existing.name,
      defaultModel: patch.defaultModel ?? existing.defaultModel,
      supportedModels: patch.supportedModels ?? existing.supportedModels,
      contextWindow: patch.contextWindow ?? existing.contextWindow,
      updatedAt: now,
    };

    db.prepare(`
      UPDATE user_llm SET
        protocol = @protocol,
        base_url = @baseUrl,
        api_key = @apiKey,
        name = @name,
        default_model = @defaultModel,
        supported_models = @supportedModels,
        context_window = @contextWindow,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: next.id,
      protocol: next.protocol,
      baseUrl: next.baseUrl,
      apiKey: encryptApiKey(next.apiKey), // 落库即密文
      name: next.name,
      defaultModel: next.defaultModel,
      supportedModels: JSON.stringify(next.supportedModels),
      contextWindow: next.contextWindow,
      updatedAt: now,
    });

    return next;
  }

  delete(id: string): boolean {
    const db = getDatabase();
    const res = db.prepare('DELETE FROM user_llm WHERE id = ?').run(id);
    return res.changes > 0;
  }

  /** 仅暴露 apiKey 是否配置（不返回明文），供列表展示 key 状态 */
  listApiKeysByUser(userId: string): UserLLMApiKeySummary[] {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT id, protocol, name, api_key FROM user_llm WHERE user_id = ? ORDER BY created_at ASC')
      .all(userId) as Pick<UserLLMRow, 'id' | 'protocol' | 'name' | 'api_key'>[];
    return rows.map((r) => ({
      id: r.id,
      hasApiKey: Boolean(r.api_key),
      protocol: r.protocol as UserLLMProtocol,
      name: r.name,
    }));
  }

  /** supportedModels 规范化：数组直接去重，并确保含 defaultModel */
  private normalizeSupported(params: CreateUserLLMParams): string[] {
    const list = params.supportedModels?.length
      ? [...params.supportedModels]
      : [params.defaultModel];
    list.push(params.defaultModel);
    return list.filter((m, i, arr) => m && arr.indexOf(m) === i);
  }

  private rowToRecord(row: UserLLMRow): UserLLMRecord {
    return {
      id: row.id,
      userId: row.user_id,
      protocol: row.protocol as UserLLMProtocol,
      baseUrl: row.base_url,
      apiKey: decryptApiKey(row.api_key), // 读侧还原明文供运行时使用
      name: row.name,
      defaultModel: row.default_model,
      supportedModels: JSON.parse(row.supported_models ?? '[]') as string[],
      contextWindow: row.context_window,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// 单例导出
let repository: UserLLMRepository | null = null;

export function getUserLLMRepository(): UserLLMRepository {
  if (!repository) {
    repository = new UserLLMRepositoryImpl();
  }
  return repository;
}
/**
 * UserLLM Registry - 按用户隔离的自定义 LLM Provider 运行时注册表
 *
 * 与全局 llmRegistry（env 驱动）平级但完全隔离：每个 userId 一个独立注册表，
 * 懒加载该用户导入的 Provider，供模型选择主链（pipeline / Agent 编排 / revise）
 * 经 llm-gateway 解析。不把用户 key 注入全局注册中心，避免跨用户可见。
 */

import type { LLMProvider } from './types';
import { getUserLLMRepository, type UserLLMRecord } from '../store/sqlite';
import { createUserLLMProvider } from './user-llm-factory';

export interface UserProviderEntry {
  record: UserLLMRecord;
  provider: LLMProvider;
}

export interface UserModelDescriptor {
  providerId: string;
  /** 注入 /api/models 的 adapter 唯一 ID */
  adapterId: string;
  adapterName: string;
  ownerUserId: string;
  protocol: 'openai' | 'anthropic';
  defaultModel: string;
  supportedModels: string[];
  models: Array<{ modelId: string }>;
}

export class UserLLMRegistry {
  private entries: UserProviderEntry[] = [];

  constructor(private readonly ownerUserId: string) {
    this.load();
  }

  /** 从 DB 按用户加载并构造 Provider 实例 */
  private load(): void {
    this.entries = getUserLLMRepository()
      .listByUser(this.ownerUserId)
      .map((record) => ({ record, provider: createUserLLMProvider(record) }));
  }

  /** 导入/编辑/删除后使缓存失效并重建 */
  reload(): void {
    this.load();
  }

  getUserId(): string {
    return this.ownerUserId;
  }

  getEntries(): UserProviderEntry[] {
    return this.entries;
  }

  /** 按模型 ID 命中，未指定或未命中时回退该用户默认（首个导入） */
  get(modelId?: string): LLMProvider | undefined {
    if (this.entries.length === 0) return undefined;
    if (modelId) {
      const hit = this.entries.find((e) => e.record.supportedModels.includes(modelId));
      if (hit) return hit.provider;
    }
    return this.getDefault();
  }

  getDefault(): LLMProvider | undefined {
    return this.entries[0]?.provider;
  }

  /** 供 /api/models 注入与配置页展示的模型描述 */
  descriptors(): UserModelDescriptor[] {
    return this.entries.map((e) => ({
      providerId: e.record.id,
      adapterId: `user-${e.record.id}`,
      adapterName: e.record.name,
      ownerUserId: this.ownerUserId,
      protocol: e.record.protocol,
      defaultModel: e.record.defaultModel,
      supportedModels: e.record.supportedModels,
      models: e.record.supportedModels.map((modelId) => ({ modelId })),
    }));
  }

  isEmpty(): boolean {
    return this.entries.length === 0;
  }
}

const store = new Map<string, UserLLMRegistry>();

/** 懒加载并缓存某用户的注册表（DB 读 + 实例构造） */
export function getUserLLMRegistry(userId: string): UserLLMRegistry {
  const existing = store.get(userId);
  if (existing) return existing;
  const reg = new UserLLMRegistry(userId);
  store.set(userId, reg);
  return reg;
}

/** 导入/编辑/删除后使缓存失效重建（CRUD API 调用） */
export function reloadUserLLM(userId: string): void {
  const reg = store.get(userId);
  if (reg) reg.reload();
}
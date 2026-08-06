/**
 * 认证存储适配层
 *
 * @novel/auth 不直接依赖具体数据库实现，而是通过 configureAuth() 注入存储适配器。
 * 这样包可被任意应用复用：应用只需提供 getDatabase（最小 SQL 接口）与 getUserById。
 */

/** 最小 SQL 接口：仅暴露 auth 需要的 prepare().get()/run()，兼容 better-sqlite3 */
export interface AuthDatabase {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number };
  };
}

/** 对外公开的用户信息（不含密码哈希） */
export interface PublicUser {
  id: string;
  username: string;
  email: string | null;
  createdAt: number;
}

/** 认证存储适配器：由宿主应用注入 */
export interface AuthStore {
  getDatabase(): AuthDatabase;
  /** 按 id 取公开用户；不存在返回 null */
  getUserById(id: string): PublicUser | null;
}

/**
 * Store 挂载到 globalThis（而非模块级变量）：
 * webpack 会把本包分别打包进 instrumentation 与 route handler 等多个 bundle，
 * 模块级变量在 bundle 间不共享；globalThis 保证 configureAuth 注入后处处可见。
 */
const GLOBAL_KEY = Symbol.for('@novel/auth/store');

function readStore(): AuthStore | null {
  return (globalThis as Record<symbol, AuthStore | null>)[GLOBAL_KEY] ?? null;
}

function writeStore(store: AuthStore | null): void {
  (globalThis as Record<symbol, AuthStore | null>)[GLOBAL_KEY] = store;
}

/** 注入认证存储（应用启动时调用一次；重复调用覆盖） */
export function configureAuth(store: AuthStore): void {
  writeStore(store);
}

/** 内部访问器：未配置时抛错，避免静默空指针 */
export function getAuthStore(): AuthStore {
  const store = readStore();
  if (!store) {
    throw new Error(
      '@novel/auth 未配置存储：请先调用 configureAuth({ getDatabase, getUserById })',
    );
  }
  return store;
}

/** 测试辅助：重置已注入的存储 */
export function __resetAuthStore(): void {
  writeStore(null);
}

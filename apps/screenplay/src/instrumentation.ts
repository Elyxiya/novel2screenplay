/**
 * Next.js Instrumentation：服务端启动时注册 @novel/auth 的存储注入
 *
 * @novel/auth 是存储无关的认证包，通过 configureAuth 注入 SQLite 依赖：
 * - getDatabase: 复用 app 的 SQLite 连接（会话表读写）
 * - getUserById: 包装 user-repository（getById + toPublic，剥除密码哈希）
 */
export async function register() {
  const { configureAuth } = await import('@novel/auth/store');
  const { getDatabase, getUserRepository } = await import('@/lib/store/sqlite');

  configureAuth({
    getDatabase,
    getUserById: (id: string) => {
      const repo = getUserRepository();
      const user = repo.getById(id);
      return user ? repo.toPublic(user) : null;
    },
  });
}

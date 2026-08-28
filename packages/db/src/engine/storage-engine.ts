/**
 * DbEngine - 存储引擎抽象（同步语义）
 *
 * 统一 SQLite / PostgreSQL 的存储访问能力，屏蔽底层差异：
 * - prepare().run / get / all 覆盖全部 CRUD 调用面（现有 repository 已仅用这三者）
 * - exec / applySchema / migrations / healthCheck 覆盖初始化与迁移
 * - all() 需暴露 rowCount / changes（用于 deleteByUser 等调用）
 *
 * 调用方（pipeline / orchestrator / repository）保持同步、零感知。
 */

export type StorageKind = 'sqlite' | 'postgres';

/** 预编译语句的独立绑定结果：一次绑定即可多次执行（对齐 better-sqlite3 Statement API） */
export interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: bigint | number };
  get<T extends object = Record<string, unknown>>(...params: unknown[]): T | undefined;
  all<T extends object = Record<string, unknown>>(...params: unknown[]): T[];
}

/** run/get/all 兼容单条一函数回调的便捷 API（可选，供需要单一入口的场景） */
export interface DbEngine {
  readonly kind: StorageKind;

  /** 获取当前存储类型（同 kind） */
  getKind(): StorageKind;

  /** 预编译一条 SQL 语句（可复用绑定） */
  prepare(sql: string): PreparedStatement;

  /** 执行任意 SQL（建表/DDL/迁移；PG 用 exec 数组兜底） */
  exec(sql: string): void;

  /** 应用完整 schema（按引擎分发 SQLite schema.sql / PG schema.pg.sql） */
  applySchema(): void;

  /** 健康检查 */
  healthCheck(): boolean;

  /** 关闭底层连接（测试/优雅关闭用） */
  close(): void;
}
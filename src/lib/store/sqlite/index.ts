/**
 * SQLite Store - 持久化存储层
 *
 * 导出所有 Repository 和数据库工具函数。
 */

// 数据库管理
export { getDatabase, closeDatabase, runMigrations, healthCheck } from './db';

// Repository
export { getJobRepository, type JobRepository, type CreateJobParams, type UpdateJobParams } from './job-repository';
export { getNovelRepository, type NovelRepository, type NovelAsset, type NovelSummary, type CreateNovelParams } from './novel-repository';
export { getProjectRepository, type ProjectRepository, type CreateProjectParams, type UpdateProjectParams } from './project-repository';
export { getHistoryRepository, type HistoryRepository, type CreateHistoryParams } from './history-repository';
export { getUserRepository, type UserRepository, type User, type PublicUser } from './user-repository';

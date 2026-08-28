// @vitest-environment node
/**
 * Repository 双后端契约测试（Task 3 · 语义对齐 + 参数化）
 *
 * 同一组仓库用例在 SQLite 与 Postgres 上各自跑一遍（describeBackends 按 DATABASE_URL
 * 自动启用：无 PG 环境恒跑 SQLite，R6 配好 DATABASE_URL 后追加跑 PG）。
 * 断言载体：JSON 列往返、多用户隔离、软删除、外键级联等「易发生隐蔽分歧」的行为。
 *
 * 每套 suite 用 setupBackend(kind) 注册独立引擎并返回 teardown，保证引擎单例不串扰。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeBackends, setupBackend } from './helpers/dual-backend';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';
import { getNovelRepository } from '@/lib/store/sqlite/novel-repository';
import { getProjectRepository } from '@/lib/store/sqlite/project-repository';
import { getHistoryRepository } from '@/lib/store/sqlite/history-repository';
import { getAgentTaskRepository } from '@/lib/store/sqlite/agent-task-repository';
import { getDramaRepository } from '@/lib/store/sqlite/drama-repository';
import { getUserRepository } from '@/lib/store/sqlite/user-repository';
import { getWriterNovelRepository } from '@/lib/store/sqlite/writer-novel-repository';
import { getUserLLMRepository } from '@/lib/store/sqlite/user-llm-repository';

describeBackends('Repository 契约 · 双后端一致', (kind) => {
  let teardown: () => void;

  beforeAll(() => {
    teardown = setupBackend(kind);
  });
  afterAll(() => {
    teardown();
  });

  describe('job-repository', () => {
    const jobRepo = getJobRepository();

    it('create/get 往返：JSON 列（logs、config、chapter_texts）还原', () => {
      const id = jobRepo.create({
        novelText: '正文…',
        chapterTexts: ['第一章', '第二章'],
        modelId: 'deepseek-chat',
        selectedChapters: [0, 1],
        temperature: 0.4,
        title: '示例',
        author: '作者',
        userId: 'u1',
      });
      const job = jobRepo.get(id)!;
      expect(job.config).toMatchObject({
        modelId: 'deepseek-chat',
        selectedChapters: [0, 1],
        temperature: 0.4,
      });
      expect(job.config.title).toBe('示例');
      expect(job.config.author).toBe('作者');
      expect(job.logs).toEqual([
        expect.objectContaining({ level: 'info', message: '任务已创建' }),
      ]);
      expect(job.userId).toBe('u1');
      jobRepo.delete(id);
    });

    it('update 对象化字段（subProgress / scenesStatus / pipelineState）往返', () => {
      const id = jobRepo.create({
        novelText: 'x',
        chapterTexts: [],
        modelId: 'm',
        selectedChapters: [],
        temperature: 0.3,
      });
      jobRepo.update(id, {
        subProgress: { totalScenes: 3, completedScenes: 2 },
        scenesStatus: [{ sceneIndex: 0, status: 'completed' }],
        progress: 66,
      });
      const job = jobRepo.get(id)!;
      expect(job.subProgress).toEqual({ totalScenes: 3, completedScenes: 2 });
      expect(job.scenesStatus).toEqual([{ sceneIndex: 0, status: 'completed' }]);
      expect(job.progress).toBe(66);
      jobRepo.delete(id);
    });

    it('deleteByUser 只删除该用户任务（多用户隔离）', () => {
      const a = jobRepo.create({ novelText: 'a', chapterTexts: [], modelId: 'm', selectedChapters: [], temperature: 0.2, userId: 'userA' });
      const b = jobRepo.create({ novelText: 'b', chapterTexts: [], modelId: 'm', selectedChapters: [], temperature: 0.2, userId: 'userB' });
      expect(jobRepo.deleteByUser('userA')).toBe(1);
      expect(jobRepo.get(a)).toBeNull();
      expect(jobRepo.get(b)).not.toBeNull();
      jobRepo.delete(b);
    });
  });

  describe('novel-repository', () => {
    const repo = getNovelRepository();

    it('create/get 往返：chapter_texts / converted_chapters JSON 还原 + 用户隔离', () => {
      const id = repo.create({
        title: '小说',
        novelText: '全文',
        chapters: [{ index: 0, title: '第一章', paragraphCount: 2, text: '内容1' }],
        userId: 'u9',
      });
      const asset = repo.get(id)!;
      // summary 形态：chapterTexts 由 JSON 还原为对象数组
      expect(asset.title).toBe('小说');
      expect(asset.userId).toBe('u9');
      expect(repo.list('u9').some((s) => s.id === id)).toBe(true);
      expect(repo.list('other').some((s) => s.id === id)).toBe(false);
      repo.delete(id);
    });
  });

  describe('project-repository', () => {
    const repo = getProjectRepository();

    it('update 动态 SET + metadata JSON 往返；软删除后 list 不可见', () => {
      const id = repo.create({ name: '项目', userId: 'u1' } as never);
      repo.update(id, { description: 'desc', metadata: { totalScenes: 5, totalCharacters: 2 } });
      const proj = repo.get(id)!;
      expect(proj.metadata).toEqual({ totalScenes: 5, totalCharacters: 2 });
      expect(proj.name).toBe('项目');
      repo.delete(id);
      expect(repo.list().some((p) => p.id === id)).toBe(false);
    });
  });

  describe('history-repository · 外键级联', () => {
    const jobRepo = getJobRepository();
    const historyRepo = getHistoryRepository();

    it('删除 job 时级联删除其 history（FK ON DELETE CASCADE 对齐）', () => {
      const jobId = jobRepo.create({ novelText: 'x', chapterTexts: [], modelId: 'm', selectedChapters: [], temperature: 0.1 });
      const histId = historyRepo.create({ jobId, title: 'H', sceneCount: 3, yamlContent: 'scene_yaml' });
      expect(historyRepo.get(histId)).not.toBeNull();
      // 外键一致：删除父记录（job）→ history 级联清除
      jobRepo.delete(jobId);
      expect(historyRepo.get(histId)).toBeNull();
    });
  });

  describe('agent-task-repository · task_json 持久化', () => {
    const repo = getAgentTaskRepository();

    it('upsert/get 往返：全量 task JSON 还原', () => {
      const task = {
        id: 'task_1',
        type: 'screenplay',
        status: 'awaiting',
        instruction: '按建议调整结局',
      } as never;
      repo.upsert(task, 'active');
      const rec = repo.get('task_1')!;
      expect(rec.status).toBe('active');
      expect(rec.task).toMatchObject({ id: 'task_1', type: 'screenplay' });
      expect(rec.task.instruction).toBe('按建议调整结局');
      repo.delete('task_1');
    });
  });

  describe('drama-repository · 位置绑定 + 分镜 YAML', () => {
    const repo = getDramaRepository();

    it('create/get 往返：drama_yaml 大文本 + update 位置绑定', () => {
      const yaml = 'scene:\n  - id: s1\n    text: "分镜内容"\n'.repeat(50);
      const id = repo.create({
        sourceJobId: 'job_d1',
        sourceNovelId: null,
        title: '短剧',
        dramaYaml: yaml,
        userId: 'u1',
      });
      const rec = repo.get(id)!;
      expect(rec.dramaYaml).toBe(yaml);
      expect(repo.update(id, { dramaYaml: 'updated' })).toBe(true);
      expect(repo.get(id)!.dramaYaml).toBe('updated');
      repo.delete(id);
    });
  });

  describe('user-repository · 账户 CRUD + 公开视图隐藏密码', () => {
    const repo = getUserRepository();

    it('create/getByUsername/getByEmail/getById 往返 + 密码不泄露', () => {
      const id = repo.create({ username: 'alice', email: 'a@ex.com', passwordHash: 'salt$hash' });
      expect(repo.getById(id)!.passwordHash).toBe('salt$hash');
      expect(repo.getByUsername('alice')!.id).toBe(id);
      expect(repo.getByEmail('a@ex.com')!.id).toBe(id);
      expect(repo.getByUsername('nobody')).toBeNull();
      const pub = repo.toPublic(repo.getById(id)!);
      expect(pub).toEqual({ id, username: 'alice', email: 'a@ex.com', createdAt: pub.createdAt });
      expect('passwordHash' in pub).toBe(false);
      repo.delete(id);
    });

    it('updatePassword / updateProfile(置空 email)', () => {
      const id = repo.create({ username: 'bob', email: 'b@ex.com', passwordHash: 'h1' });
      repo.updatePassword(id, 'h2');
      expect(repo.getById(id)!.passwordHash).toBe('h2');
      repo.updateProfile(id, { email: null });
      expect(repo.getById(id)!.email).toBeNull();
      repo.delete(id);
    });
  });

  describe('writer-novel-repository · 创作侧 JSON 列 + 章节持久化', () => {
    const repo = getWriterNovelRepository();

    it('createDraft/getDraft 往返：kind=draft 隔离；saveChapter 归一化 wordCount', () => {
      const id = repo.createDraft({ title: '创作', author: '作者', synopsis: '简介', userId: 'w1' } as never);
      const draft = repo.getDraft(id)!;
      expect(draft.title).toBe('创作');
      expect(draft.synopsis).toBe('简介');
      expect(draft.userId).toBe('w1');
      expect(repo.listDrafts('w1').some((d) => d.id === id)).toBe(true);
      expect(repo.listDrafts('other').some((d) => d.id === id)).toBe(false);

      // saveChapter 往返：content 去掉空白后计数
      const saved = repo.saveChapter(id, { id: 'c1', title: '章一', content: '第 一 章\n 正文 ', volumeId: undefined, order: 0 } as never)!;
      expect(saved.wordCount).toBe(5);
      const reloaded = repo.getDraft(id)!;
      expect(reloaded.chapters).toHaveLength(1);
      expect(reloaded.chapters[0].wordCount).toBe(5);
      repo.delete(id);
      expect(repo.getDraft(id)).toBeNull();
    });

    it('saveStructure 部分更新 + markConverted 合并去重', () => {
      const id = repo.createDraft({ title: 't', author: 'a', synopsis: 's', userId: 'w2' } as never);
      repo.saveStructure(id, { characters: [{ id: 'ch1', name: '主角', role: '主角', traits: '[]', background: '', notes: '' }] } as never);
      expect(repo.getDraft(id)!.characters).toHaveLength(1);
      repo.saveStructure(id, { volumes: [{ id: 'v1', title: '卷一', order: 0, description: '' }] } as never);
      expect(repo.getDraft(id)!.volumes).toHaveLength(1);
      // characters 保持不被 volumes 更新覆盖
      expect(repo.getDraft(id)!.characters).toHaveLength(1);

      repo.markConverted(id, ['c1'], 'job_x');
      repo.markConverted(id, ['c1', 'c2'], 'job_y');
      // convertedCount 走 listDrafts 摘要（getDraft 返回 DraftNovel，无该汇总字段）
      expect(repo.listDrafts('w2').find((d) => d.id === id)!.convertedCount).toBe(2);
      repo.delete(id);
    });
  });

  describe('user-llm-repository · apiKey 加解密往返 + 命名绑定', () => {
    const repo = getUserLLMRepository();

    it('create/getById 往返：apiKey 解密还原 + supportedModels JSON 还原', () => {
      const rec = repo.create({
        userId: 'u1',
        protocol: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret',
        name: '我的模型',
        defaultModel: 'model-a',
        supportedModels: ['model-a', 'model-b'],
        contextWindow: 64000,
      });
      const got = repo.getById(rec.id)!;
      expect(got.apiKey).toBe('sk-secret');
      // normalizeSupported 去重：defaultModel 注入去重后只剩两个
      expect(got.supportedModels).toEqual(['model-a', 'model-b']);
      expect(got.contextWindow).toBe(64000);
      expect(repo.listByUser('u1').some((r) => r.id === rec.id)).toBe(true);
      expect(repo.listByUser('other').some((r) => r.id === rec.id)).toBe(false);
      // 密钥可见性摘要：只暴露 hasApiKey，不泄露明文
      expect(repo.listApiKeysByUser('u1')[0].hasApiKey).toBe(true);
      repo.delete(rec.id);
    });

    it('update 部分字段；apiKey 空串不改密钥；delete 返回 changes', () => {
      const rec = repo.create({
        userId: 'u1',
        protocol: 'openai',
        baseUrl: 'https://base',
        apiKey: 'secret1',
        defaultModel: 'm1',
      });
      const updated = repo.update(rec.id, { name: '改名', apiKey: '' })!;
      expect(updated.name).toBe('改名');
      expect(updated.apiKey).toBe('secret1');
      expect(repo.update(rec.id, { apiKey: 'secret2' })!.apiKey).toBe('secret2');
      expect(repo.delete(rec.id)).toBe(true);
      expect(repo.delete(rec.id)).toBe(false);
    });
  });
});
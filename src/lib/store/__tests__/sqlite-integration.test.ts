/**
 * Phase 1 Integration Tests
 *
 * 测试 SQLite 持久化和 SSE 推送的集成功能。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { jobStore } from '../job-store';
import { getDatabase, closeDatabase } from '../sqlite/db';
import type { PipelineJob } from '../../types/api';

describe('SQLite JobStore Integration', () => {
  beforeAll(() => {
    // 确保数据库初始化
    getDatabase();
  });

  afterAll(() => {
    closeDatabase();
  });

  beforeEach(() => {
    // 清理测试数据
    const db = getDatabase();
    db.exec('DELETE FROM jobs WHERE id LIKE "test_%"');
  });

  describe('create', () => {
    it('should create a new job', () => {
      const jobId = jobStore.create({
        novelText: '测试小说内容',
        chapterTexts: ['第1章', '第2章'],
        modelId: 'test-model',
        selectedChapters: [0, 1],
        temperature: 0.7,
      });

      expect(jobId).toBeDefined();
      expect(jobId.startsWith('job_')).toBe(true);
    });

    it('should retrieve created job', () => {
      const jobId = jobStore.create({
        novelText: '测试小说内容',
        chapterTexts: ['第1章'],
        modelId: 'test-model',
        selectedChapters: [0],
        temperature: 0.7,
      });

      const job = jobStore.get(jobId);
      expect(job).toBeDefined();
      expect(job?.novelText).toBe('测试小说内容');
      expect(job?.chapterTexts).toEqual(['第1章']);
    });
  });

  describe('update', () => {
    it('should update job status', () => {
      const jobId = jobStore.create({
        novelText: '测试',
        chapterTexts: ['第1章'],
        modelId: 'test',
        selectedChapters: [0],
        temperature: 0.7,
      });

      jobStore.update(jobId, (job) => ({
        ...job,
        status: 'analyzing' as const,
        progress: 50,
      }));

      const job = jobStore.get(jobId);
      expect(job?.status).toBe('analyzing');
      expect(job?.progress).toBe(50);
    });

    it('should append logs', () => {
      const jobId = jobStore.create({
        novelText: '测试',
        chapterTexts: ['第1章'],
        modelId: 'test',
        selectedChapters: [0],
        temperature: 0.7,
      });

      jobStore.update(jobId, (job) => ({
        ...job,
        logs: [
          ...job.logs,
          { timestamp: Date.now(), level: 'info', message: '测试日志' },
        ],
      }));

      const job = jobStore.get(jobId);
      expect(job?.logs.length).toBeGreaterThan(1);
      expect(job?.logs[job.logs.length - 1].message).toBe('测试日志');
    });
  });

  describe('list', () => {
    it('should list all jobs', () => {
      // 创建多个测试任务
      for (let i = 0; i < 3; i++) {
        jobStore.create({
          novelText: `测试${i}`,
          chapterTexts: ['第1章'],
          modelId: 'test',
          selectedChapters: [0],
          temperature: 0.7,
        });
      }

      const jobs = jobStore.list();
      expect(jobs.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by status', () => {
      const jobId = jobStore.create({
        novelText: '测试',
        chapterTexts: ['第1章'],
        modelId: 'test',
        selectedChapters: [0],
        temperature: 0.7,
      });

      jobStore.update(jobId, (job) => ({
        ...job,
        status: 'completed' as const,
      }));

      const completedJobs = jobStore.listByStatus('completed');
      expect(completedJobs.some((j) => j.id === jobId)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a job', () => {
      const jobId = jobStore.create({
        novelText: '测试',
        chapterTexts: ['第1章'],
        modelId: 'test',
        selectedChapters: [0],
        temperature: 0.7,
      });

      jobStore.delete(jobId);
      const job = jobStore.get(jobId);
      expect(job).toBeUndefined();
    });
  });
});

describe('Database Health Check', () => {
  it('should pass health check', () => {
    const { healthCheck } = require('../sqlite/db');
    expect(healthCheck()).toBe(true);
  });
});

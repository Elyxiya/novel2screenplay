import { describe, it, expect } from 'vitest';
import {
  VolumeSchema,
  ChapterSchema,
  CharacterCardSchema,
  WorldItemSchema,
  DraftNovelSchema,
  CreateDraftParamsSchema,
} from '../novel.js';

describe('novel.schema', () => {
  describe('VolumeSchema', () => {
    it('接受合法卷结构', () => {
      const r = VolumeSchema.safeParse({ id: 'v1', title: '第一卷 序章', order: 0, description: '起点' });
      expect(r.success).toBe(true);
    });

    it('拒绝空标题', () => {
      const r = VolumeSchema.safeParse({ id: 'v1', title: '', order: 0 });
      expect(r.success).toBe(false);
    });

    it('description 缺省为空串', () => {
      const r = VolumeSchema.parse({ id: 'v1', title: '第一卷', order: 1 });
      expect(r.description).toBe('');
    });
  });

  describe('ChapterSchema', () => {
    it('接受合法章节并计算默认值', () => {
      const r = ChapterSchema.parse({ id: 'c1', volumeId: 'v1', title: '第一章', order: 0, content: '正文', updatedAt: 1 });
      expect(r.wordCount).toBe(0);
    });

    it('拒绝空标题', () => {
      const r = ChapterSchema.safeParse({ id: 'c1', volumeId: null, title: '', order: 0, updatedAt: 1 });
      expect(r.success).toBe(false);
    });

    it('volumeId 可空', () => {
      const r = ChapterSchema.parse({ id: 'c1', volumeId: null, title: '无卷章节', order: 0, updatedAt: 1 });
      expect(r.volumeId).toBeNull();
    });
  });

  describe('CharacterCardSchema / WorldItemSchema', () => {
    it('接受合法人物卡', () => {
      const r = CharacterCardSchema.safeParse({ id: 'p1', name: '林晚', role: '主角', traits: '冷静', background: '出身寒门' });
      expect(r.success).toBe(true);
    });

    it('拒绝无名人卡', () => {
      const r = CharacterCardSchema.safeParse({ id: 'p1', name: '' });
      expect(r.success).toBe(false);
    });

    it('接受合法世界观词条', () => {
      const r = WorldItemSchema.safeParse({ id: 'w1', name: '雾都', category: '地理', description: '常年浓雾' });
      expect(r.success).toBe(true);
    });
  });

  describe('DraftNovelSchema', () => {
    it('接受完整创作小说结构', () => {
      const draft = {
        id: 'novel_1',
        title: '雾都孤影',
        author: '作者',
        synopsis: '简介',
        volumes: [{ id: 'v1', title: '第一卷', order: 0, description: '' }],
        chapters: [{ id: 'c1', volumeId: 'v1', title: '第一章', order: 0, content: '正文', wordCount: 2, updatedAt: 1 }],
        characters: [{ id: 'p1', name: '林晚', role: '主角', traits: '', background: '', notes: '' }],
        worldItems: [{ id: 'w1', name: '雾都', category: '地理', description: '' }],
        userId: 'u1',
        createdAt: 1,
        updatedAt: 1,
      };
      const r = DraftNovelSchema.safeParse(draft);
      expect(r.success).toBe(true);
    });
  });

  describe('CreateDraftParamsSchema', () => {
    it('接受最小入参', () => {
      const r = CreateDraftParamsSchema.safeParse({ title: '新小说' });
      expect(r.success).toBe(true);
    });

    it('拒绝空标题', () => {
      const r = CreateDraftParamsSchema.safeParse({ title: '' });
      expect(r.success).toBe(false);
    });

    it('author/synopsis 有默认值', () => {
      const r = CreateDraftParamsSchema.parse({ title: '新小说' });
      expect(r.author).toBe('');
      expect(r.synopsis).toBe('');
    });
  });
});

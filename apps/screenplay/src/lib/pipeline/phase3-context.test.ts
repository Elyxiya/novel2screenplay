import { describe, it, expect } from 'vitest';
import {
  resolveKeyCharacters,
  selectSceneCharacters,
  buildRollingSummary,
  buildOpenThreadContext,
} from './phase3-context';
import type { RawCharacter, SceneBoundary, SettingCard } from '@novel/contracts/pipeline';

function mkScene(overrides: Partial<SceneBoundary> = {}): SceneBoundary {
  return {
    sceneIndex: 1,
    chapterIndex: 2,
    startParagraph: 0,
    endParagraph: 5,
    originalStartOffset: 0,
    originalEndOffset: 500,
    draftSlugline: '外景. 山顶 - 日',
    keyCharacterNames: [],
    summary: '测试场景',
    ...overrides,
  };
}

const characters: RawCharacter[] = [
  { name: '林墨', aliases: ['小林', '墨公子'], personalityTags: [], description: '主角', isMajor: true, sourceChapterIndex: 0 },
  { name: '苏晚', aliases: ['晚儿'], personalityTags: [], description: '女主', isMajor: true, sourceChapterIndex: 1 },
  { name: '老者', aliases: ['神秘人'], personalityTags: [], description: '配角', isMajor: false, sourceChapterIndex: 2 },
  { name: '围观者', aliases: [], personalityTags: [], description: '路人', isMajor: false, sourceChapterIndex: 1 },
];

function buildAliasIndex(chars: RawCharacter[]): Map<string, string> {
  const map = new Map<string, string>();
  chars.forEach((c, i) => {
    const id = `char_${String(i + 1).padStart(2, '0')}`;
    map.set(c.name, id);
    c.aliases.forEach((a) => map.set(a, id));
  });
  return map;
}

describe('resolveKeyCharacters (Task 3.1)', () => {
  const index = buildAliasIndex(characters);

  it('解析全命中 → 占位率 0', () => {
    const r = resolveKeyCharacters(['林墨', '晚儿', '神秘人'], index);
    expect(r.unresolved).toEqual([]);
    expect(r.placeholderRate).toBe(0);
    expect(r.resolved.map((x) => x.charId)).toEqual(['char_01', 'char_02', 'char_03']);
  });

  it('部分未命中 → 未命中名进 unresolved 且占位率正确', () => {
    const r = resolveKeyCharacters(['林墨', '不存在的角色'], index);
    expect(r.unresolved).toEqual(['不存在的角色']);
    expect(r.placeholderRate).toBe(0.5);
    expect(r.resolved).toEqual([{ name: '林墨', charId: 'char_01' }]);
  });

  it('全未命中 → 占位率 1', () => {
    const r = resolveKeyCharacters(['路人甲', '路人乙'], index);
    expect(r.placeholderRate).toBe(1);
    expect(r.resolved).toEqual([]);
  });

  it('空输入 → 占位率 0（无角色可占位）', () => {
    const r = resolveKeyCharacters([], index);
    expect(r.placeholderRate).toBe(0);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });
});

describe('selectSceneCharacters (Task 3.2 主角常驻 + 配角按键)', () => {
  it('主角常驻注入，不受 keyCharacterNames 影响', () => {
    const scene = mkScene({ keyCharacterNames: ['围观者'] });
    const sel = selectSceneCharacters(scene, characters);
    expect(sel.majorKept).toBe(2);
    expect(sel.keyKept).toBe(1);
    const names = sel.kept.map((c) => c.name);
    expect(names).toContain('林墨');
    expect(names).toContain('苏晚');
    expect(names).toContain('围观者');
  });

  it('按键配角经别名命中（老者=神秘人）', () => {
    const scene = mkScene({ keyCharacterNames: ['神秘人'] });
    const sel = selectSceneCharacters(scene, characters);
    expect(sel.keyKept).toBe(1);
    expect(sel.kept.map((c) => c.name)).toContain('老者');
  });

  it('keyCharacterNames 全未命中 → 仍保留主角（不回退全量）', () => {
    const scene = mkScene({ keyCharacterNames: ['不存在'] });
    const sel = selectSceneCharacters(scene, characters);
    expect(sel.majorKept).toBe(2);
    expect(sel.keyKept).toBe(0);
    expect(sel.kept.map((c) => c.name)).toEqual(['林墨', '苏晚']);
  });

  it('无主角且未命中 → 回退全量（兜底防空）', () => {
    const allMinor = characters.map((c) => ({ ...c, isMajor: false }));
    const scene = mkScene({ keyCharacterNames: ['不存在'] });
    const sel = selectSceneCharacters(scene, allMinor);
    expect(sel.kept).toHaveLength(allMinor.length);
  });
});

describe('buildRollingSummary (Task 3.2 滚动摘要)', () => {
  const settingCard: SettingCard = {
    chapterSummaries: [
      { chapterIndex: 0, summary: '第一章：主角登场' },
      { chapterIndex: 1, summary: '第二章：女主出现' },
      { chapterIndex: 2, summary: '第三章：老者现身' },
      { chapterIndex: 3, summary: '第四章：冲突升级' },
      { chapterIndex: 4, summary: '第五章：转折' },
      { chapterIndex: 5, summary: '第六章：高潮' },
      { chapterIndex: 6, summary: '第七章：后续' },
    ],
    openThreads: [],
  };

  it('只取 chapterIndex 之前的章节，最多 maxChapters 条', () => {
    const s = buildRollingSummary(settingCard, 5);
    expect(s).toContain('[第 1 章] 第一章：主角登场');
    expect(s).toContain('[第 5 章] 第五章：转折');
    expect(s).not.toContain('[第 6 章]');
    expect(s).not.toContain('[第 7 章]');
    // chapterIndex=5 之前有 0..4 共 5 章，maxChapters=5 → 全含
    expect(s.split('\n')).toHaveLength(5);
  });

  it('默认上限 5 章，之前章更多时截断取最近 5 章', () => {
    const s = buildRollingSummary(settingCard, 7);
    const lines = s.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('[第 3 章]');
    expect(lines[lines.length - 1]).toContain('[第 7 章]');
  });

  it('settingCard 缺失 → 空串', () => {
    expect(buildRollingSummary(undefined, 3)).toBe('');
  });
});

describe('buildOpenThreadContext (Task 3.2 区间注入)', () => {
  const settingCard: SettingCard = {
    chapterSummaries: [],
    openThreads: [
      { id: 't1', title: '神秘玉佩', description: '玉佩来历不明', startChapterIndex: 1, endChapterIndex: undefined },
      { id: 't2', title: '师门恩怨', description: '三十年前旧事', startChapterIndex: 1, endChapterIndex: 4 },
      { id: 't3', title: '已了结的仇', description: '本章已报', startChapterIndex: 0, endChapterIndex: 2 },
    ],
  };

  it('区间内（start<=章<=end 或未闭合）注入', () => {
    const s = buildOpenThreadContext(settingCard, 2);
    expect(s).toContain('神秘玉佩'); // 未闭合，持续注入
    expect(s).toContain('师门恩怨'); // 1<=2<=4
    expect(s).toContain('已了结的仇'); // 0<=2<=2（end 闭合章仍含）
  });

  it('已过闭合章的线索不再注入', () => {
    const s = buildOpenThreadContext(settingCard, 5);
    expect(s).not.toContain('师门恩怨'); // end=4 < 5
    expect(s).not.toContain('已了结的仇'); // end=2 < 5
    expect(s).toContain('神秘玉佩'); // 未闭合
  });

  it('start 未到的线索不注入', () => {
    const s = buildOpenThreadContext(settingCard, 0);
    expect(s).not.toContain('神秘玉佩'); // start=1 > 0
    expect(s).not.toContain('师门恩怨'); // start=1 > 0
    expect(s).toContain('已了结的仇'); // start=0
  });

  it('settingCard 缺失 → 空串', () => {
    expect(buildOpenThreadContext(undefined, 2)).toBe('');
  });
});

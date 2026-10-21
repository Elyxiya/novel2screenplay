import { describe, it, expect } from 'vitest';
import type { RawCharacter, SceneBoundary } from '@novel/contracts/pipeline';
import {
  applySanitizePlanToScenes,
  buildSanitizePlan,
  measureEvidence,
  splitParagraphs,
} from '@/lib/pipeline/character-sanitizer';

function character(name: string, aliases: string[] = [], extra: Partial<RawCharacter> = {}): RawCharacter {
  return {
    name,
    aliases,
    personalityTags: [],
    description: '',
    isMajor: false,
    sourceChapterIndex: 0,
    ...extra,
  };
}

function scene(chapterIndex: number, start: number, end: number, names: string[]): SceneBoundary {
  return {
    sceneIndex: 0,
    chapterIndex,
    startParagraph: start,
    endParagraph: end,
    originalStartOffset: 0,
    originalEndOffset: 0,
    draftSlugline: '',
    keyCharacterNames: names,
    summary: '',
  };
}

describe('measureEvidence —— 证据只取自原文', () => {
  it('按非空行切段，与 Phase 2 的口径一致', () => {
    expect(splitParagraphs('甲\n\n乙\n  \n丙')).toEqual(['甲', '乙', '丙']);
  });

  it('统计跨章数与提及次数（含别名）', () => {
    const chapters = ['大副走了过来。\n大副冷笑。', '船长看着大副。'];
    const e = measureEvidence('大副', [], chapters);
    expect(e.chapters).toBe(2);
    expect(e.mentions).toBe(3);
  });

  it('引号行数只作次级信号', () => {
    // 口径：名字与该段引号出现在同一段（本项目一段=一个非空行，常见形态是「大副：“……”」）
    const chapters = ['大副：“你怎么看？”\n大副沉默。'];
    expect(measureEvidence('大副', [], chapters).quotedLines).toBe(1);
  });
});

describe('buildSanitizePlan —— 描述性实体三分法', () => {
  const texts = [
    // 第 1 章：描述性路人（1 次）+ 青衫老者与墨管家同段
    '一名月白衣袍老者端坐上位。\n对着房外的一名青衫老者微笑道：“走吧，墨管家。”',
    // 第 2 章：大副（职务名，非描述）
    '大副走了过来。\n“大副，你在做什么？”',
  ];
  const characters: RawCharacter[] = [
    character('墨管家'),
    character('大副'),
    character('月白衣袍老者'),
    character('青衫老者'),
  ];

  it('职务名/专名永远保留（不因“不是专名”被误杀）', () => {
    const plan = buildSanitizePlan(characters, texts);
    expect(plan.kept.map((c) => c.name)).toContain('大副');
  });

  it('描述性实体证据不足 → 丢弃', () => {
    const plan = buildSanitizePlan(characters, texts);
    expect(plan.dropped.map((d) => d.name)).toContain('月白衣袍老者');
  });

  it('同段同指 → 记替换关系（青衫老者 = 墨管家）', () => {
    const plan = buildSanitizePlan(characters, texts);
    expect(plan.replaced['青衫老者']).toBe('墨管家');
    expect(plan.dropped.map((d) => d.name)).toContain('青衫老者');
  });

  it('跨段共现不建立替换（防把路人并进主角）', () => {
    const crossParagraph = ['一名青衫老者走过。\n墨管家鞠了一躬。'];
    const plan = buildSanitizePlan([character('墨管家'), character('青衫老者')], crossParagraph);
    expect(plan.replaced['青衫老者']).toBeUndefined();
  });

  it('同段但对立关系不建立替换（防把路人抬成主角）', () => {
    // 实测原文：英俊青年拔剑直指萧炎——同段共现，但明显是两个人
    const text = '一旁的那位英俊青年，豁然的拔出长剑，目光阴冷的直指萧炎。';
    const plan = buildSanitizePlan([character('萧炎'), character('英俊青年')], [text]);
    expect(plan.replaced['英俊青年']).toBeUndefined();
  });

  it('跨章 ≥2 或 提及 ≥3 的描述会保留（无名但有重量）', () => {
    const recurring = ['烧伤疤痕老头坐在门口。\n老头咳了一声。', '老头又来了。'];
    const plan = buildSanitizePlan([character('老头')], recurring);
    expect(plan.kept.map((c) => c.name)).toContain('老头');
  });

  it('开关关闭时原样返回', () => {
    process.env.CHARACTER_SANITIZE = 'off';
    const plan = buildSanitizePlan(characters, texts);
    expect(plan.disabled).toBe(true);
    expect(plan.kept).toHaveLength(characters.length);
    delete process.env.CHARACTER_SANITIZE;
  });
});

describe('applySanitizePlanToScenes —— 级联清理', () => {
  it('替换同段指代并移除已丢弃的名字', () => {
    const plan = buildSanitizePlan(
      [character('墨管家'), character('青衫老者'), character('月白衣袍老者')],
      ['对着房外的一名青衫老者微笑道：“走吧，墨管家。”\n一名月白衣袍老者端坐上位。'],
    );
    const result = applySanitizePlanToScenes(
      [scene(0, 0, 1, ['青衫老者', '萧炎']), scene(0, 0, 1, ['月白衣袍老者', '萧炎'])],
      plan,
    );
    expect(result.scenes[0].keyCharacterNames).toEqual(['墨管家', '萧炎']);
    expect(result.scenes[1].keyCharacterNames).toEqual(['萧炎']);
    expect(result.changed).toBe(2);
  });

  it('未点名的未知角色不动（不掩盖 Phase 2 漏抽）', () => {
    const plan = buildSanitizePlan([character('方晓语')], ['方晓语笑了。']);
    const result = applySanitizePlanToScenes([scene(0, 0, 0, ['方晓语', '豆豆'])], plan);
    expect(result.scenes[0].keyCharacterNames).toEqual(['方晓语', '豆豆']);
    expect(result.changed).toBe(0);
  });

  it('幂等：连续应用两次结果一致', () => {
    const plan = buildSanitizePlan(
      [character('墨管家'), character('青衫老者'), character('月白衣袍老者')],
      ['对着房外的一名青衫老者微笑道：“走吧，墨管家。”\n一名月白衣袍老者端坐上位。'],
    );
    const once = applySanitizePlanToScenes([scene(0, 0, 1, ['青衫老者', '月白衣袍老者', '萧炎'])], plan);
    const twice = applySanitizePlanToScenes(once.scenes, plan);
    expect(twice.scenes[0].keyCharacterNames).toEqual(once.scenes[0].keyCharacterNames);
    expect(twice.changed).toBe(0);
  });
});

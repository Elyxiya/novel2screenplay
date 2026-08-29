/**
 * 身份断言集（TS 运行时版）— Task 2 身份规则的运行时复用（Task 4.1）
 *
 * 从 `scripts/eval/identity.mjs` 移植的确定性身份一致性规则（纯函数、零成本、零漂移），
 * 供 ReviewGate / orchestrator 决策层 / 经典链重转桥接器复用。
 *
 * 只针对「身份一致性」：
 * - 确定性规则输入依赖人工标注的死亡/揭示章，不从输出反推；
 *   标注为空时所有规则通过（零误报、零成本）。
 * - 语义断言（身份矛盾 judge）仍由 eval 侧的 scripts/eval/identity.mjs 承担，
 *   本模块不引入 LLM 调用（规则层保证确定性）。
 */

import type { Scene } from '@novel/contracts/screenplay';
import type { IdentityFailure, IdentitySignal } from '../multi-agent/handoff-protocol';

export interface IdentityRuleMeta {
  ruleId: string;
  kind: 'rule' | 'semantic';
  name: string;
  description: string;
}

export const IDENTITY_RULES: Record<string, IdentityRuleMeta> = {
  deadCharacterNoSpeak: {
    ruleId: 'dead-character-no-speak',
    kind: 'rule',
    name: '已死角色不再开口',
    description: '标注为某章死亡的角色的对白，不得出现在源章节晚于死亡章的场景中。',
  },
  revealBeforeChapter: {
    ruleId: 'reveal-before-chapter',
    kind: 'rule',
    name: '揭示称谓不提前',
    description: '标注在 R 章揭示的隐藏身份名，不得出现在源章节早于 R 章的场景中。',
  },
  unresolvedAliasAsId: {
    ruleId: 'unresolved-alias-as-id',
    kind: 'rule',
    name: '别名未被解析成实体 id',
    description: '场景里直接拿别名当 characterId 使用（未解析为 char_N），计入身份可解析性失败。',
  },
};

/** 参与运行时判定的确定性规则（默认全集；语义规则走 eval 侧 judge，不在此列） */
export const DEFAULT_IDENTITY_RULE_IDS: string[] = [
  IDENTITY_RULES.deadCharacterNoSpeak.ruleId,
  IDENTITY_RULES.revealBeforeChapter.ruleId,
  IDENTITY_RULES.unresolvedAliasAsId.ruleId,
];

/** 单个规则的结果 */
export interface IdentityRuleResult {
  ruleId: string;
  passed: boolean;
  failures: IdentityFailure[];
}

/** 身份断言输入：场景 + charId 索引 + 人工标注（死亡/揭示/别名） */
export interface IdentityRuleData {
  scenes: Scene[];
  charIdToName: Record<string, string>;
  deadCharacters: Array<{ name: string; deathChapter: number }>;
  reveals: Array<{ secretName: string; revealChapter: number }>;
  aliasIndex: Record<string, string>;
}

/**
 * 取一个场景的源章节：sourceChapterRange 起点 → sourceRefs 最小 chapterIndex → null（无法判定）。
 */
export function sceneSourceChapter(scene: Scene): number | null {
  if (scene.sourceChapterRange) return scene.sourceChapterRange[0];
  const refs = scene.content.flatMap((b) => b.sourceRefs ?? []);
  const chapters = refs.map((r) => r.chapterIndex).filter((n) => Number.isFinite(n));
  if (chapters.length === 0) return null;
  return Math.min(...chapters);
}

/**
 * 规则 1：已死角色不再开口。
 */
export function runDeadCharacterNoSpeakRule(data: IdentityRuleData): IdentityRuleResult {
  const failures: IdentityFailure[] = [];
  for (const scene of data.scenes) {
    const src = sceneSourceChapter(scene);
    if (src === null) continue; // 无法判定源章节 → 跳过
    for (const block of scene.content) {
      if (block.type !== 'dialogue') continue;
      const name = data.charIdToName[block.characterId];
      const dead = data.deadCharacters.find((d) => d.name === name);
      if (dead && src > dead.deathChapter) {
        failures.push({
          ruleId: IDENTITY_RULES.deadCharacterNoSpeak.ruleId,
          sceneNumber: scene.sceneNumber,
          message: `已死角色「${name}」（死亡章 ${dead.deathChapter}）在源章节 ${src} 的场景 #${scene.sceneNumber} 仍有对白`,
        });
      }
    }
  }
  return {
    ruleId: IDENTITY_RULES.deadCharacterNoSpeak.ruleId,
    passed: failures.length === 0,
    failures,
  };
}

/**
 * 规则 2：揭示称谓不提前。secretName 在揭示章 R 之前不得以该身份被点名。
 */
export function runRevealBeforeChapterRule(data: IdentityRuleData): IdentityRuleResult {
  const failures: IdentityFailure[] = [];
  for (const scene of data.scenes) {
    const src = sceneSourceChapter(scene);
    if (src === null) continue;
    for (const reveal of data.reveals) {
      if (src >= reveal.revealChapter) continue; // 揭示后出现是合法的
      const texts = scene.content.map((b) => (b.type === 'dialogue' ? b.line : b.description));
      const hitLine = texts.find((t) => t.includes(reveal.secretName));
      const namedAsId = scene.characterIds.some(
        (id) => data.charIdToName[id] === reveal.secretName,
      );
      if (hitLine !== undefined || namedAsId) {
        failures.push({
          ruleId: IDENTITY_RULES.revealBeforeChapter.ruleId,
          sceneNumber: scene.sceneNumber,
          message: `隐藏身份「${reveal.secretName}」应在章 ${reveal.revealChapter} 揭示，但源章节 ${src} 的场景 #${scene.sceneNumber} 已点名`,
        });
      }
    }
  }
  return {
    ruleId: IDENTITY_RULES.revealBeforeChapter.ruleId,
    passed: failures.length === 0,
    failures,
  };
}

/**
 * 规则 3：别名未被解析成实体 id。
 */
export function runUnresolvedAliasAsIdRule(data: IdentityRuleData): IdentityRuleResult {
  const failures: IdentityFailure[] = [];
  for (const scene of data.scenes) {
    const ids = new Set(scene.characterIds);
    for (const block of scene.content) {
      if (block.type === 'dialogue') ids.add(block.characterId);
    }
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(data.aliasIndex, id)) {
        failures.push({
          ruleId: IDENTITY_RULES.unresolvedAliasAsId.ruleId,
          sceneNumber: scene.sceneNumber,
          message: `场景 #${scene.sceneNumber} 直接用别名「${id}」作 characterId（应解析为 ${data.aliasIndex[id]}）`,
        });
      }
    }
  }
  return {
    ruleId: IDENTITY_RULES.unresolvedAliasAsId.ruleId,
    passed: failures.length === 0,
    failures,
  };
}

/** 按 ruleId 分发确定性规则。 */
export function runIdentityRule(ruleId: string, data: IdentityRuleData): IdentityRuleResult {
  switch (ruleId) {
    case IDENTITY_RULES.deadCharacterNoSpeak.ruleId:
      return runDeadCharacterNoSpeakRule(data);
    case IDENTITY_RULES.revealBeforeChapter.ruleId:
      return runRevealBeforeChapterRule(data);
    case IDENTITY_RULES.unresolvedAliasAsId.ruleId:
      return runUnresolvedAliasAsIdRule(data);
    default:
      return {
        ruleId,
        passed: false,
        failures: [{ ruleId, sceneNumber: 0, message: `未知规则：${ruleId}` }],
      };
  }
}

/** 批量跑确定性规则。 */
export function runIdentityRules(ruleIds: string[], data: IdentityRuleData): IdentityRuleResult[] {
  return ruleIds.map((id) => runIdentityRule(id, data));
}

export interface IdentityAssessmentOptions {
  /** 参与判定的规则（默认 DEFAULT_IDENTITY_RULE_IDS 全量确定性规则） */
  ruleIds?: string[];
  /** 每个失败场景的扣分（默认 20，分数下限 0） */
  penaltyPerFailure?: number;
}

/**
 * 运行身份一致性评估（确定性规则优先），产出 identity 信号。
 * 标注为空 → 全部通过（passed: true, score: 100），保证零误报。
 */
export function runIdentityAssessment(
  data: IdentityRuleData,
  options: IdentityAssessmentOptions = {},
): IdentitySignal {
  const ruleIds = options.ruleIds ?? DEFAULT_IDENTITY_RULE_IDS;
  const penalty = options.penaltyPerFailure ?? 20;
  const results = runIdentityRules(ruleIds, data);
  const failures = results.flatMap((r) => r.failures);
  const passed = failures.length === 0;
  const score = Math.max(0, 100 - failures.length * penalty);
  return { passed, score, failures };
}

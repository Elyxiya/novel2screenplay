/**
 * Eval 数据集注册（T2-C2）
 *
 * set 注册表 → 产出格子（cell）列表。
 * - `identity-fixture`：合成样本（免标注、确定性），专测规则路径，零 LLM 成本，CI 可用。
 * - `identity`：真实标注样本集（别名密集/多线/章节边界，3–5 短 + 3–5 中），
 *   由人工标注死亡/揭示章后填充；语义断言走 judge。
 */

import { IDENTITY_RULES } from './identity.mjs';

// ── fixture：合成样本（场景形状与 identity.mjs 规则消费的字段一致） ─────

const dlg = (characterId, line, chapterIndex) => ({
  type: 'dialogue',
  characterId,
  line,
  sourceRefs: [{ chapterIndex, paragraphIndex: 0, excerpt: line }],
});
const act = (description, chapterIndex) => ({
  type: 'action',
  description,
  sourceRefs: [{ chapterIndex, paragraphIndex: 0, excerpt: description }],
});
const scene = (sceneNumber, characterIds, content, sourceChapterRange) => ({
  sceneNumber,
  slugline: `SC ${sceneNumber}`,
  timeOfDay: 'night',
  locationId: 'loc_1',
  characterIds,
  content,
  sourceChapterRange,
});

// 样本 A：老秦在 ch5 死亡，但 ch7 的场景仍有对白 → 触发 dead-character-no-speak
const fixtureDeadSpeaks = {
  id: 'fixture-dead-speaks',
  scenes: [
    scene(1, ['char_1', 'char_2'], [act('老秦交代后事。', 4)], [4, 4]),
    scene(2, ['char_2', 'char_1'], [dlg('char_1', '老秦的仇，我来报。', 7)], [7, 7]),
  ],
  charIdToName: { char_1: '老秦', char_2: '苏晚' },
  aliasIndex: { 老秦: 'char_1', 秦爷: 'char_1', 苏晚: 'char_2' },
  deadCharacters: [{ name: '老秦', deathChapter: 5 }],
  reveals: [],
};

// 样本 B：苏晚的隐藏身份「前朝公主」应在 ch8 揭示，但 ch3 的场景已点名 → 触发 reveal-before-chapter
const fixtureRevealEarly = {
  id: 'fixture-reveal-early',
  scenes: [
    scene(1, ['char_2'], [dlg('char_2', '我乃前朝公主。', 3)], [3, 3]),
    scene(2, ['char_2'], [act('苏晚承认身份。', 9)], [9, 9]),
  ],
  charIdToName: { char_2: '苏晚' },
  aliasIndex: { 苏晚: 'char_2' },
  deadCharacters: [],
  reveals: [{ secretName: '前朝公主', revealChapter: 8 }],
};

// 样本 C：场景直接用别名「秦爷」作 characterId → 触发 unresolved-alias-as-id
const fixtureAliasAsId = {
  id: 'fixture-alias-as-id',
  scenes: [scene(1, ['秦爷', 'char_2'], [dlg('秦爷', '交给我。', 2)], [2, 2])],
  charIdToName: { char_2: '苏晚' },
  aliasIndex: { 老秦: 'char_1', 秦爷: 'char_1', 苏晚: 'char_2' },
  deadCharacters: [],
  reveals: [],
};

// 样本 D：干净样本，三规则全过
const fixtureClean = {
  id: 'fixture-clean',
  scenes: [
    scene(1, ['char_1', 'char_2'], [dlg('char_1', '此去凶险，你留下。', 2)], [2, 2]),
    scene(2, ['char_2'], [act('苏晚望向远山。', 3)], [3, 3]),
  ],
  charIdToName: { char_1: '老秦', char_2: '苏晚' },
  aliasIndex: { 老秦: 'char_1', 秦爷: 'char_1', 苏晚: 'char_2' },
  deadCharacters: [],
  reveals: [],
};

const FIXTURE_SAMPLES = [fixtureDeadSpeaks, fixtureRevealEarly, fixtureAliasAsId, fixtureClean];

/** 把样本串成可 token 预估的输入文本（规则格子预览用）。 */
function sampleToText(sample) {
  return JSON.stringify(
    { scenes: sample.scenes, charIdToName: sample.charIdToName, aliasIndex: sample.aliasIndex },
    null,
    1,
  );
}

/**
 * 构建 identity 断言格子。
 * @param {'identity-fixture'|'identity'} setName
 * @param {{ modelId?: string, datasetHash?: string, judgePromptHash?: string }} opts
 */
export function buildIdentityCells(setName, opts = {}) {
  const modelId = opts.modelId ?? 'default';
  const datasetHash = opts.datasetHash ?? 'unversioned';
  const judgePromptHash = opts.judgePromptHash ?? 'identity-judge-v1';

  const base = { set: setName, stage: 'convert', modelId, datasetHash, judgePromptHash, params: {} };

  const samples = setName === 'identity-fixture' ? FIXTURE_SAMPLES : [];
  const ruleIds = [
    IDENTITY_RULES.deadCharacterNoSpeak.ruleId,
    IDENTITY_RULES.revealBeforeChapter.ruleId,
    IDENTITY_RULES.unresolvedAliasAsId.ruleId,
  ];

  const cells = [];
  for (const sample of samples) {
    for (const ruleId of ruleIds) {
      cells.push({
        ...base,
        id: `${sample.id}:${ruleId}`,
        sampleId: sample.id,
        assertionId: ruleId,
        kind: 'rule',
        // 规则格子零 LLM：输出即规则结果 JSON（几百 token 内），dry-run 预算如实计
        outputEstimate: 100,
        inputText: sampleToText(sample),
        data: {
          scenes: sample.scenes,
          charIdToName: sample.charIdToName,
          aliasIndex: sample.aliasIndex,
          deadCharacters: sample.deadCharacters,
          reveals: sample.reveals,
        },
      });
    }
  }
  // identity 真实集尚未标注：注册语义格子的骨架（标注后填充）
  if (setName === 'identity') {
    cells.push({
      ...base,
      id: 'identity:semantic-pending',
      sampleId: 'pending-annotation',
      assertionId: IDENTITY_RULES.identityContradiction.ruleId,
      kind: 'semantic',
      // 语义 judge 双评委默认预估 2k 输出
      outputEstimate: 2000,
      inputText: '',
      data: { content: '' },
    });
  }
  return cells;
}

/** 列出可用 set。 */
export function listSets() {
  return [
    { name: 'identity-fixture', description: '合成身份断言样本（零 LLM，CI 安全）', cells: 12 },
    { name: 'identity', description: '真实标注样本集（人工标注死亡/揭示章后可用，含语义 judge）', cells: 1 },
  ];
}

/** 按名字取格子。 */
export function resolveSet(setName, opts) {
  if (setName === 'identity-fixture' || setName === 'identity') {
    return buildIdentityCells(setName, opts);
  }
  throw new Error(`未知 eval set：${setName}（可用：${listSets().map((s) => s.name).join(', ')}）`);
}

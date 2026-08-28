/**
 * 身份断言集（T2-C2 / T2-C3）
 *
 * 只针对「身份一致性」：
 * - 确定性规则（零成本、零漂移）用纯函数规则检查，输入依赖人工标注的死亡/揭示章，不从输出反推。
 * - 语义断言才走 judge（双评委），兜规则查不到的矛盾。
 *
 * 输入数据结构（annotation）为人工标注产物，规则均为纯函数，可离线单测。
 */

export const IDENTITY_JUDGE_PROMPT = `你是身份一致性评审。检查以下剧本片段中是否存在「同一实体被以互相矛盾的身份对待」的情况：
- 同一角色在不同场景被当成两个人（分裂）
- 一个角色同时具备互斥身份/立场（如既是盟友又是敌人）
- 已死亡角色仍在说话（若片段内可判断）
对每个场景输出 JSON：
{"scenes":[{"sceneNumber":1,"verdict":"pass|fail","reason":"..."}]}
只输出 JSON，不要其他文字。`;

// ── 规则定义 ────────────────────────────────────────────────────────────

export const IDENTITY_RULES = {
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
  identityContradiction: {
    ruleId: 'identity-contradiction',
    kind: 'semantic',
    name: '身份矛盾（judge）',
    description: '同一实体被以互相矛盾身份对待；兜确定性规则查不到的语义矛盾。',
  },
};

/**
 * 取一个场景的源章节：sourceChapterRange 起点 → sourceRefs 最小 chapterIndex → null（无法判定）。
 * @param {import('@novel/contracts/screenplay').Scene} scene
 * @returns {number | null}
 */
export function sceneSourceChapter(scene) {
  if (scene.sourceChapterRange) return scene.sourceChapterRange[0];
  const refs = (scene.content || []).flatMap((b) => b.sourceRefs || []);
  const chapters = refs.map((r) => r.chapterIndex).filter((n) => Number.isFinite(n));
  if (chapters.length === 0) return null;
  return Math.min(...chapters);
}

/**
 * 规则 1：已死角色不再开口。
 * @param {{
 *   scenes: Array<import('@novel/contracts/screenplay').Scene>,
 *   charIdToName: Record<string, string>,
 *   deadCharacters: Array<{ name: string, deathChapter: number }>,
 * }} data
 * @returns {{ ruleId: string, passed: boolean, failures: Array<{sceneNumber:number,message:string}> }}
 */
export function runDeadCharacterNoSpeakRule({ scenes, charIdToName, deadCharacters }) {
  const failures = [];
  for (const scene of scenes) {
    const src = sceneSourceChapter(scene);
    if (src === null) continue; // 无法判定源章节 → 跳过
    for (const block of scene.content) {
      if (block.type !== 'dialogue') continue;
      const name = charIdToName[block.characterId];
      const dead = deadCharacters.find((d) => d.name === name);
      if (dead && src > dead.deathChapter) {
        failures.push({
          sceneNumber: scene.sceneNumber,
          message: `已死角色「${name}」（死亡章 ${dead.deathChapter}）在源章节 ${src} 的场景 #${scene.sceneNumber} 仍有对白`,
        });
      }
    }
  }
  return { ruleId: IDENTITY_RULES.deadCharacterNoSpeak.ruleId, passed: failures.length === 0, failures };
}

/**
 * 规则 2：揭示称谓不提前。secretName 在揭示章 R 之前不得以该身份被点名。
 * @param {{
 *   scenes: Array<import('@novel/contracts/screenplay').Scene>,
 *   charIdToName: Record<string, string>,
 *   reveals: Array<{ secretName: string, revealChapter: number }>,
 * }} data
 */
export function runRevealBeforeChapterRule({ scenes, charIdToName, reveals }) {
  const failures = [];
  for (const scene of scenes) {
    const src = sceneSourceChapter(scene);
    if (src === null) continue;
    for (const reveal of reveals) {
      if (src >= reveal.revealChapter) continue; // 揭示后出现是合法的
      const texts = scene.content.map((b) => (b.type === 'dialogue' ? b.line : b.description));
      const hitLine = texts.find((t) => t.includes(reveal.secretName));
      const namedAsId = scene.characterIds.some(
        (id) => charIdToName[id] === reveal.secretName,
      );
      if (hitLine !== undefined || namedAsId) {
        failures.push({
          sceneNumber: scene.sceneNumber,
          message: `隐藏身份「${reveal.secretName}」应在章 ${reveal.revealChapter} 揭示，但源章节 ${src} 的场景 #${scene.sceneNumber} 已点名`,
        });
      }
    }
  }
  return { ruleId: IDENTITY_RULES.revealBeforeChapter.ruleId, passed: failures.length === 0, failures };
}

/**
 * 规则 3：别名未被解析成实体 id。
 * aliasIndex: 别名 → 规范 charId（来自 Phase1 reduce 的别名索引）。
 * 场景中出现的 characterId 若本身就是别名（应被解析为 char_N），计为解析失败。
 * @param {{
 *   scenes: Array<import('@novel/contracts/screenplay').Scene>,
 *   aliasIndex: Record<string, string>,
 * }} data
 */
export function runUnresolvedAliasAsIdRule({ scenes, aliasIndex }) {
  const failures = [];
  for (const scene of scenes) {
    const ids = new Set(scene.characterIds);
    for (const block of scene.content) {
      if (block.type === 'dialogue') ids.add(block.characterId);
    }
    for (const id of ids) {
      if (Object.prototype.hasOwnProperty.call(aliasIndex, id)) {
        failures.push({
          sceneNumber: scene.sceneNumber,
          message: `场景 #${scene.sceneNumber} 直接用别名「${id}」作 characterId（应解析为 ${aliasIndex[id]}）`,
        });
      }
    }
  }
  return { ruleId: IDENTITY_RULES.unresolvedAliasAsId.ruleId, passed: failures.length === 0, failures };
}

/** 按 ruleId 分发确定性规则。 */
export function runIdentityRule(ruleId, data) {
  switch (ruleId) {
    case IDENTITY_RULES.deadCharacterNoSpeak.ruleId:
      return runDeadCharacterNoSpeakRule(data);
    case IDENTITY_RULES.revealBeforeChapter.ruleId:
      return runRevealBeforeChapterRule(data);
    case IDENTITY_RULES.unresolvedAliasAsId.ruleId:
      return runUnresolvedAliasAsIdRule(data);
    default:
      return { ruleId, passed: false, failures: [{ sceneNumber: 0, message: `未知规则：${ruleId}` }] };
  }
}

/**
 * 批量跑确定性规则。
 * @param {string[]} ruleIds
 * @param {Record<string, unknown>} data
 */
export function runIdentityRules(ruleIds, data) {
  return ruleIds.map((id) => runIdentityRule(id, data));
}

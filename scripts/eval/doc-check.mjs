/**
 * 文档一致性校对（零依赖、只读）。
 *
 * 为什么需要：经验文档里有三类信息最容易腐烂——
 *   1. 文件路径（重命名/删除后没人改）；
 *   2. 阈值与默认值（代码改了、文档没改）；
 *   3. 开关名（环境变量改名后文档仍在教旧名字）。
 * 这三类都可以机械校验，没必要每轮靠人 grep。
 *
 * 用法：node scripts/eval/doc-check.mjs
 * 退出码：0 全过；1 有 FAIL（便于将来挂 CI，但当前不改 CI）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const DOCS = [
  'docs/conversion-quality/lessons-learned-2026-10.md',
  'docs/conversion-quality/gold-annotation-workflow.md',
  'docs/conversion-quality/flip-decision-record.md',
];

const results = [];
const ok = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail) => results.push({ ok: false, name, detail });

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/**
 * 标识符级包含判断。
 *
 * 为什么不用 includes：`tinyScenesRenamed` 包含 `tinyScenes`，改名后的实现会被判成
 * 「仍然存在」——变异测试实测踩过，检查静默通过。这里要求前后不是标识符字符。
 */
function hasToken(src, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`).test(src);
}

// ── 1. 文档里出现的代码路径必须存在 ──────────────────────────────────────
{
  const missing = [];
  for (const doc of DOCS) {
    const text = read(doc);
    const paths = [...text.matchAll(/`((?:apps|scripts|packages|docs)\/[^`\s]+)`/g)]
      .map((m) => m[1])
      .filter((p) => /\.(ts|tsx|mjs|md|sql)$/.test(p));
    for (const rel of new Set(paths)) {
      if (!fs.existsSync(path.join(ROOT, rel))) missing.push(`${rel}（${path.basename(doc)}）`);
    }
  }
  missing.length
    ? fail('文档引用的文件路径都存在', missing.join('；'))
    : ok('文档引用的文件路径都存在');
}

// ── 2. 阈值与代码常量一致 ────────────────────────────────────────────────
{
  const code = read('apps/screenplay/src/lib/pipeline/character-sanitizer.ts');
  const num = (re, label) => {
    const m = code.match(re);
    if (!m) throw new Error(`代码里找不到 ${label}`);
    return Number(m[1]);
  };
  const minChapters = num(/DEFAULT_MIN_CHAPTERS\s*=\s*(\d+)/, 'DEFAULT_MIN_CHAPTERS');
  const minMentions = num(/DEFAULT_MIN_MENTIONS\s*=\s*(\d+)/, 'DEFAULT_MIN_MENTIONS');
  const corefGap = num(/MAX_COREF_GAP\s*=\s*(\d+)/, 'MAX_COREF_GAP');

  const checks = [];
  for (const doc of ['docs/conversion-quality/lessons-learned-2026-10.md', 'docs/conversion-quality/gold-annotation-workflow.md']) {
    const text = read(doc);
    // 必须检查**所有**出现处：文档里同一阈值常出现多次（页首红线 + 正文），
    // 只匹配第一处会漏掉后文的漂移（实测踩过：页首对、正文错，检查仍 PASS）。
    for (const m of text.matchAll(/跨章\s*≥\s*(\d+)/g)) {
      if (Number(m[1]) !== minChapters) checks.push(`${path.basename(doc)} 跨章阈值 ${m[1]} ≠ 代码 ${minChapters}`);
    }
    for (const m of text.matchAll(/提及\s*≥\s*(\d+)/g)) {
      if (Number(m[1]) !== minMentions) checks.push(`${path.basename(doc)} 提及阈值 ${m[1]} ≠ 代码 ${minMentions}`);
    }
  }
  const lessons = read('docs/conversion-quality/lessons-learned-2026-10.md');
  for (const m of lessons.matchAll(/≤\s*(\d+)\s*字/g)) {
    if (Number(m[1]) !== corefGap) checks.push(`lessons 紧邻阈值 ${m[1]} ≠ 代码 ${corefGap}`);
  }

  checks.length
    ? fail('阈值与代码常量一致', checks.join('；'))
    : ok('阈值与代码常量一致', `跨章≥${minChapters} / 提及≥${minMentions} / 紧邻≤${corefGap} 字`);
}

// ── 3. 文档提到的开关必须真的被代码读取 ──────────────────────────────────
{
  const SWITCHES = {
    CHARACTER_SANITIZE: 'apps/screenplay/src/lib/pipeline/character-sanitizer.ts',
    SCENE_CHARACTER_GROUNDING: 'apps/screenplay/src/lib/pipeline/scene-character-grounding.ts',
    PHASE1_MODE: 'apps/screenplay/src/lib/pipeline/phase1-budget.ts',
    CONVERT_PROMPT_FILE: 'apps/screenplay/src/lib/llm/prompts/convert-scene.ts',
  };
  const corpus = DOCS.map(read).join('\n');
  const bad = [];
  for (const [name, file] of Object.entries(SWITCHES)) {
    if (!corpus.includes(name)) continue; // 文档没提就不用校验
    const src = read(file);
    // 两种合法读法：直接 process.env.NAME，或经参数注入 env.NAME（phase1-budget 就是后者）
    const used = src.includes(`process.env.${name}`) || src.includes(`.${name}`);
    if (!used) bad.push(`${name}（${file} 未读取）`);
  }
  bad.length ? fail('文档提到的环境开关真实存在', bad.join('；')) : ok('文档提到的环境开关真实存在');
}

// ── 4. 三份文档互相引用 ──────────────────────────────────────────────────
{
  const names = DOCS.map((d) => path.basename(d));
  const bad = [];
  for (const doc of DOCS) {
    const text = read(doc);
    for (const other of names) {
      if (other === path.basename(doc)) continue;
      if (!text.includes(other)) bad.push(`${path.basename(doc)} 未链接 ${other}`);
    }
  }
  bad.length ? fail('三份文档互链', bad.join('；')) : ok('三份文档互链');
}

// ── 5. 文档承诺的口径/规则，在实现里真实存在 ────────────────────────────
//
// 这一类最容易「文档写了、代码没有」——上次发现的墓碑字段漏记就是反过来的版本。
// 规则：文档里出现 phrase 时，对应实现文件必须包含 token；文档没提则跳过。
{
  const RULES = [
    { doc: 'gold-annotation-workflow.md', phrase: '描述性别名', file: 'scripts/eval/annotation.mjs', token: 'DESCRIPTOR_ALIAS_RE' },
    { doc: 'gold-annotation-workflow.md', phrase: '墓碑', file: 'scripts/eval/annotation.mjs', token: 'excludedCharacters' },
    { doc: 'gold-annotation-workflow.md', phrase: 'IoU', file: 'scripts/eval/annotation.mjs', token: 'iou' },
    { doc: 'gold-annotation-workflow.md', phrase: '宏平均', file: 'scripts/eval/annotation.mjs', token: 'macroAverage' },
    { doc: 'gold-annotation-workflow.md', phrase: 'characterRefs', file: 'scripts/eval/annotation.mjs', token: 'characterRefs' },
    { doc: 'lessons-learned-2026-10.md', phrase: '剔除自证', file: 'scripts/eval/annotation.mjs', token: 'checkIndependence' },
    { doc: 'flip-decision-record.md', phrase: 'R1/R2/R3', file: 'apps/screenplay/src/lib/eval/flip-decision.ts', token: 'R1' },
  ];
  const bad = [];
  for (const rule of RULES) {
    const docText = read(`docs/conversion-quality/${rule.doc}`);
    if (!docText.includes(rule.phrase)) continue;
    if (!hasToken(read(rule.file), rule.token)) {
      bad.push(`${rule.doc} 承诺「${rule.phrase}」，但 ${path.basename(rule.file)} 缺少 ${rule.token}`);
    }
  }
  bad.length ? fail('文档承诺的规则在实现中存在', bad.join('；')) : ok('文档承诺的规则在实现中存在', `${RULES.length} 条`);
}

// ── 6. 反向检查：文档里写的 gold 字段，校验器是否认识 ────────────────────
//
// 第 5 类是「文档短语 → 实现 token」的手工映射；这一类反过来扫文档：
// 示例 JSON 里出现的每个字段，validateGold 里都应有对应分支（纯元数据除外）。
// 曾经的反例：文档写了 excludedCharacters.evidence/reason，校验器完全没查。
{
  const doc = read('docs/conversion-quality/gold-annotation-workflow.md');
  const code = read('scripts/eval/annotation.mjs');
  // 纯展示用元数据：不参与校验，允许实现里不出现
  // split 由 freeze 阶段用 splitFor 计算并写入，validateGold 不校验它。
  const ALLOW = new Set(['reviewedBy', 'split']);

  const blocks = [...doc.matchAll(/```jsonc?\r?\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  const keys = new Set([...blocks.matchAll(/"([A-Za-z][A-Za-z0-9_]*)"\s*:/g)].map((m) => m[1]));

  // 防「空输入即通过」：解析不到任何字段时不能算 PASS。
  // 实测踩过：CRLF 让围栏正则失配，字段数变 0，检查照样报 PASS——比报错更危险。
  if (keys.size === 0) {
    fail('文档示例的 gold 字段都被校验器覆盖', '未能从文档解析出任何字段（检查失效，检查围栏与换行符）');
  } else {
    const unknown = [...keys].filter((k) => !hasToken(code, k) && !ALLOW.has(k));
    unknown.length
      ? fail('文档示例的 gold 字段都被校验器覆盖', `未在 annotation.mjs 中校验：${unknown.join('、')}`)
      : ok('文档示例的 gold 字段都被校验器覆盖', `${keys.size} 个字段`);
  }
}

// ── 7. 文档里的「自动体检项」必须真的在 review-sheet 里实现 ──────────────
//
// 抽检单是人工判断的入口，文档列了 5 项就拿它当承诺。实现里删掉某一项、
// 或换了变量名，文档不会自己变，抽检的人却会以为那一项还在查。
{
  const RULES = [
    ['未切出场景的章节', 'missingChapters'],
    ['单段落场景', 'tinyScenes'],
    ['未在任何场景出现的角色', 'orphanCharacters'],
    ['没有别名的角色', 'noAlias'],
    ['场景中出现但角色卡未登记', 'unknownNames'],
  ];
  const doc = read('docs/conversion-quality/gold-annotation-workflow.md');
  const code = read('scripts/eval/review-sheet.mjs');
  const bad = RULES.filter(([phrase, token]) => doc.includes(phrase) && !hasToken(code, token)).map(
    ([phrase, token]) => `${phrase} → 缺 ${token}`,
  );
  bad.length
    ? fail('文档的体检项在 review-sheet 中实现', bad.join('；'))
    : ok('文档的体检项在 review-sheet 中实现', `${RULES.length} 项`);
}

// ── 8. 「未解决事项」的状态声明必须与代码一致 ────────────────────────────
//
// 待办清单最容易腐烂：状态写着「未落地」，代码其实已经改了；或反过来，
// 文档写「已落地」而代码还留着旧的默认值。这里至少守住最重要的一条——Phase1 默认模式。
// 双向校验：文档说未落地 → 代码必须仍返回 truncate；文档说已落地 → 代码必须不再返回。
{
  const doc = read('docs/conversion-quality/lessons-learned-2026-10.md');
  const code = read('apps/screenplay/src/lib/pipeline/phase1-budget.ts');
  const row = doc.split('\n').find((line) => line.includes('按长度自动分流'));

  if (!row) {
    // 条目被删掉也算一种「状态变更」，但不阻断；提示即可
    ok('「未解决事项」状态与代码一致', '未找到「按长度自动分流」条目，跳过');
  } else {
    const docSaysPending = row.includes('未落地');
    const codeReturnsTruncate = /return\s+'truncate'/.test(code);
    if (docSaysPending && !codeReturnsTruncate) {
      fail('「未解决事项」状态与代码一致', '文档说「未落地」，但 resolveDefaultPhase1Mode 已不再返回 truncate，请更新文档');
    } else if (!docSaysPending && codeReturnsTruncate) {
      fail('「未解决事项」状态与代码一致', '文档说「已落地」，但代码仍返回 truncate，请核对');
    } else {
      ok('「未解决事项」状态与代码一致', docSaysPending ? 'Phase1 默认仍为 truncate' : 'Phase1 已分流');
    }
  }
}

// ── 9. 关键数字必须可追溯时效 ────────────────────────────────────────────
//
// §七 的每条结论都是「某个时刻的水平」。不标日期，几个月后就会被当成现状。
// 规则：含数字的条目，必须带 `YYYY-MM-DD` 或「历史」标记。
{
  const doc = read('docs/conversion-quality/lessons-learned-2026-10.md');
  const start = doc.indexOf('## 七、');
  const end = doc.indexOf('### 状态快照', start);
  const section = start === -1 ? '' : doc.slice(start, end === -1 ? undefined : end);
  const undated = section
    .split('\n')
    .filter((line) => line.startsWith('- ') && /\d/.test(line))
    .filter((line) => !/历史/.test(line) && !/\d{4}-\d{2}-\d{2}/.test(line))
    .map((line) => line.slice(0, 40));

  undated.length
    ? fail('关键数字都带时效标记', `缺日期/「历史」：${undated.join(' ｜ ')}`)
    : ok('关键数字都带时效标记');
}

// ── 10. 术语一致性：三份文档不得使用已废弃的异名 ────────────────────────
//
// 异名靠人眼很难长期维持：同一次改动里，一份文档写「描述性实体」、另一份写「描述名」，
// 读的人会以为是两个东西。这里维护一份黑名单，出现即 FAIL。
{
  const DEPRECATED = ['描述名', '描述性称呼', '交叉运行'];
  const bad = [];
  for (const doc of DOCS) {
    // 维护日志会如实记录「把 X 改名为 Y」这类历史，必须排除，否则检查与记录互相打架。
    const full = read(doc);
    const logStart = full.search(/^## .*维护日志/m);
    const text = logStart === -1 ? full : full.slice(0, logStart);
    for (const term of DEPRECATED) {
      if (text.includes(term)) bad.push(`${path.basename(doc)} 使用了废弃术语「${term}」`);
    }
  }
  bad.length
    ? fail('三份文档术语一致', bad.join('；'))
    : ok('三份文档术语一致', `废弃词 ${DEPRECATED.length} 个均未出现`);
}

// ── 11. 维护日志每一行都必须可追溯（提交号或明确「进行中」）────────────────
//
// 日志里留「本轮」这类占位，过几天就没人知道对应哪个提交，等于没记。
{
  const doc = read('docs/conversion-quality/lessons-learned-2026-10.md');
  const logStart = doc.search(/^## .*维护日志/m);
  const section = logStart === -1 ? '' : doc.slice(logStart);
  const rows = section
    .split('\n')
    .filter((line) => line.startsWith('| 202') );
  const untracked = rows.filter(
    (line) => !/`[0-9a-f]{7,}`/.test(line) && !/进行中/.test(line),
  );
  rows.length === 0
    ? fail('维护日志可追溯', '未解析到任何日志行')
    : untracked.length
      ? fail('维护日志可追溯', `缺提交号：${untracked.map((l) => l.slice(0, 30)).join(' ｜ ')}`)
      : ok('维护日志可追溯', `${rows.length} 行均有提交号`);
}

// ── 12. 「可调参数」表的值必须与代码一致 ──────────────────────────────────
//
// 表里登记的是会改变输出形态的数字。代码调了、表没跟，读者会按错的值理解系统。
{
  const doc = read('docs/conversion-quality/lessons-learned-2026-10.md');
  const CONSTANTS = [
    { name: 'MAX_SCENE_TOKENS', file: 'apps/screenplay/src/lib/pipeline/ContextManager.ts' },
    { name: 'MAX_SEGMENT_TOKENS', file: 'apps/screenplay/src/lib/pipeline/ContextManager.ts' },
    { name: 'MAX_ANALYSIS_TOKENS', file: 'apps/screenplay/src/lib/pipeline/ContextManager.ts' },
  ];
  const bad = [];
  for (const { name, file } of CONSTANTS) {
    const codeMatch = read(file).match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    const docMatch = doc.match(new RegExp('`' + name + '`\\s*\\|\\s*(\\d+)'));
    if (!codeMatch) { bad.push(`${name} 在代码中未找到`); continue; }
    if (!docMatch) { bad.push(`${name} 未登记到可调参数表`); continue; }
    if (codeMatch[1] !== docMatch[1]) bad.push(`${name} 代码 ${codeMatch[1]} ≠ 文档 ${docMatch[1]}`);
  }
  // 温度是小数，单独处理
  const tCode = read('apps/screenplay/src/lib/pipeline/Phase2Segmenter.ts').match(/temperature:\s*([\d.]+)/);
  const tDoc = doc.match(/Phase2 `temperature`\s*\|\s*\*\*([\d.]+)\*\*/);
  if (tCode && tDoc && tCode[1] !== tDoc[1]) bad.push(`temperature 代码 ${tCode[1]} ≠ 文档 ${tDoc[1]}`);

  bad.length
    ? fail('可调参数表与代码一致', bad.join('；'))
    : ok('可调参数表与代码一致', `${CONSTANTS.length + 1} 项`);
}

// ── 输出 ────────────────────────────────────────────────────────────────
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  —— ${r.detail}` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exitCode = 1;

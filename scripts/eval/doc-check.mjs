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
    if (!read(rule.file).includes(rule.token)) {
      bad.push(`${rule.doc} 承诺「${rule.phrase}」，但 ${path.basename(rule.file)} 缺少 ${rule.token}`);
    }
  }
  bad.length ? fail('文档承诺的规则在实现中存在', bad.join('；')) : ok('文档承诺的规则在实现中存在', `${RULES.length} 条`);
}

// ── 输出 ────────────────────────────────────────────────────────────────
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  —— ${r.detail}` : ''}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed > 0) process.exitCode = 1;

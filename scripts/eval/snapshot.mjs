/**
 * 状态快照生成器：把四条核对命令的输出写成带时间戳的文件。
 *
 * 为什么不再手抄数字：只要代码一变，文档里抄的表就变成历史。手抄时靠「每轮人工核对」维持，
 * 只能挡住「没日期」，挡不住「日期对、数字旧」。这里让快照由脚本生成，数字与生成时间绑定，
 * 文档只引用文件，不再复制内容。
 *
 * 用法：node scripts/eval/snapshot.mjs
 * 产物：docs/conversion-quality/snapshots/snapshot-YYYY-MM-DD.md
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES = ['doupo-short', 'zhanlan-short', 'xiuzhen-short'];

function runNode(script, args = []) {
  return execFileSync(process.execPath, [path.join('scripts/eval', script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const date = new Date().toISOString().slice(0, 10);
const commit = git(['rev-parse', '--short', 'HEAD']);

// ① 抽检单体检：只取汇总行，压成纯数字列
const health = SAMPLES.map((id) => {
  const out = runNode('review-sheet.mjs', ['--sample', id, '--draft', `scripts/eval/samples/${id}/gold.json`]);
  const line = out.split('\n').find((l) => l.includes('未切出场景章节')) ?? '';
  const cells = line
    .split('｜')
    .map((seg) => seg.trim().split(/\s+/).pop())
    .join(' | ');
  return `| ${id} | ${cells} |`;
});

// ② 基线（默认 truncate，3 次均值）：只取第一张表（输出里还有逐次运行的子表）
const baselineOut = runNode('baseline.mjs');
const baselineLines = baselineOut.split('\n');
const tableStart = baselineLines.findIndex((l) => l.startsWith('| 样本'));
const baselineRows = [];
for (let i = tableStart; i >= 0 && i < baselineLines.length; i++) {
  if (!baselineLines[i].startsWith('|')) break;
  baselineRows.push(baselineLines[i]);
}

// ③ Phase1 A/B
const abOut = runNode('phase1-ab.mjs');
const abRows = abOut.split('\n').filter((l) => l.startsWith('|') || l.startsWith('- xiuzhen'));

// ④ 文档一致性
const docCheck = runNode('doc-check.mjs').trim();

const md = `# 状态快照（${date}）

> 自动生成，请勿手改：\`node scripts/eval/snapshot.mjs\`
> 提交：\`${commit}\` ｜ 生成时间：${new Date().toISOString()}

## ① 抽检单体检（0 = 干净）

| 样本 | 未切出章节 | 单段落 | 孤儿 | 无别名 | 未登记 |
|---|---|---|---|---|---|
${health.join('\n')}

## ② 基线（默认 truncate，每样本 3 次；**当前代码**）

${baselineRows.join('\n')}

> 口径：跨运行 = 剔除自证运行后的一致性（稳不稳）；准确率 = 对 reviewed 金标注（对不对）。
> 这批运行使用当前代码（segment prompt v2 + character-sanitizer + phase2-fallback + 温度 0.3）。
> 溯源基准：job 落库的 \`chapter_texts\`（管线实际输入）。

## ③ Phase1 A/B（对 reviewed 金标注；读 Phase1 原始输出）

${abRows.join('\n')}

## ④ 文档一致性

\`\`\`
${docCheck}
\`\`\`

## 复现

\`\`\`bash
node scripts/eval/snapshot.mjs
\`\`\`
`;

const outDir = path.join(ROOT, 'docs/conversion-quality/snapshots');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `snapshot-${date}.md`);
fs.writeFileSync(outFile, md, 'utf8');
console.log(`已写入 ${path.relative(ROOT, outFile)}`);

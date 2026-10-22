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
// 注意：它校验的是**金标注草稿**，不是 baseline 里的运行；运行级覆盖门禁见 ①′。
const health = SAMPLES.map((id) => {
  // --stdout：只读不写。否则生成快照会顺手改写被跟踪的 samples/<id>/review.md。
  const out = runNode('review-sheet.mjs', ['--sample', id, '--draft', `scripts/eval/samples/${id}/gold.json`, '--stdout']);
  const line = out.split('\n').find((l) => l.includes('未切出场景章节')) ?? '';
  const cells = line
    .split('｜')
    .map((seg) => seg.trim().split(/\s+/).pop())
    .join(' | ');
  return `| ${id} | ${cells} |`;
});

// ② 基线（默认 auto，3–4 次均值）：只取第一张表
const baselineOut = runNode('baseline.mjs');
const baselineLines = baselineOut.split('\n');
const tableStart = baselineLines.findIndex((l) => l.startsWith('| 样本'));
const baselineRows = [];
for (let i = tableStart; i >= 0 && i < baselineLines.length; i++) {
  if (!baselineLines[i].startsWith('|')) break;
  baselineRows.push(baselineLines[i]);
}

// ②′ 运行覆盖门禁：从 baseline 的「运行覆盖门禁」表原样取行（逐 jobId 判定）
const gateStart = baselineLines.findIndex((l) => l.startsWith('## 运行覆盖门禁'));
const gateRows = [];
for (let i = gateStart + 1; i > 0 && i < baselineLines.length; i++) {
  if (baselineLines[i].startsWith('|')) gateRows.push(baselineLines[i]);
}
const gateBody = gateRows.filter((l) => !l.startsWith('| 样本') && !/^\|\s*-+/.test(l));
const gateFails = gateBody.filter((l) => l.includes('FAIL')).length;
const gateTotal = gateBody.length;

// ③ Phase1 A/B
const abOut = runNode('phase1-ab.mjs');
const abRows = abOut.split('\n').filter((l) => l.startsWith('|') || l.startsWith('- xiuzhen'));

// ④ 文档一致性
const docCheck = runNode('doc-check.mjs').trim();

const md = `# 状态快照（${date}）

> 自动生成，请勿手改：\`node scripts/eval/snapshot.mjs\`
> 提交：\`${commit}\` ｜ 生成时间：${new Date().toISOString()}

## ① 抽检单体检（草稿；0 = 干净）

> 口径说明：这一节检查的是**金标注草稿**（\`review-sheet --draft gold.json\`），
> 不是 baseline 里那几次真实运行。运行级的「整章丢失」请看 ①′。

| 样本 | 未切出章节 | 单段落 | 孤儿 | 无别名 | 未登记 |
|---|---|---|---|---|---|
${health.join('\n')}

## ①′ 运行覆盖门禁（N 次运行；⚠️ = gold 有场景的章切出 0 场景）

> 结论：${gateFails === 0 ? `全部 ${gateTotal} 次运行通过` : `⚠️ ${gateFails}/${gateTotal} 次运行存在整章丢失`}
> 「空章」不能靠草稿体检发现——草稿是标注，不是运行；这一列直接判定 baseline 的每个 jobId。
> 覆盖判定 PASS 只表示该章至少切出了场景，不代表边界/内容正确（召回见 ②）；章节标签 chN(idxM) = 正文第 N 章 / chapterIndex M。

${gateRows.join('\n')}

## ② 基线（默认 auto，每样本 3–4 次）

${baselineRows.join('\n')}

> 口径：跨运行 = 剔除自证运行后的一致性（稳不稳）；准确率 = 对 reviewed 金标注（对不对）。
> 这批运行使用当前代码与默认 auto（三样本均超 30k → 全走 mapreduce）。
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

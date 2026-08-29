// build.mjs
// 点 3 构建：esbuild 出单文件 IIFE（背 React 运行时），供 <script> 直引 / iframe 面板宿主用。
// 用 tsc 产出 .d.ts（保留类型供 TS 宿主 import）。
import { build } from 'esbuild';
import { execSync } from 'node:child_process';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/agent-workbench.umd.js',
  bundle: true,
  format: 'iife',
  globalName: 'NovelAgentWorkbench',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  minify: false,
  sourcemap: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
}).catch((e) => {
  console.error(e);
  process.exit(1);
});

// 类型声明（Bundler 解析即可，d.ts 供 TS 宿主）。
execSync('npx tsc --emitDeclarationOnly --declaration --outDir dist/types', { stdio: 'inherit' });

console.log('[agent-workbench] build OK → dist/agent-workbench.umd.js + dist/types/*.d.ts');
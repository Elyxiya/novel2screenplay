import Link from 'next/link';

const FEATURES = [
  {
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
    title: '自动章节识别',
    desc: '上传小说文本后自动拆分章节结构，标题、段落、字数一目了然，支持追加续转已转换章节。',
  },
  {
    icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    title: 'AI 场景化重构',
    desc: 'AI 引擎将小说叙事重构为标准剧本结构：场景标题、内景/外景、角色动作与对白分层输出。',
  },
  {
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    title: '角色 / 地点识别',
    desc: '自动抽取剧本中的主要角色与故事地点，生成结构化清单，方便快速把握人物关系与场景布局。',
  },
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: '多模型选择',
    desc: '转换配置页支持切换不同 AI 模型与参数，按需调整输出质量与风格，全程进度可视、可取消、可续转。',
  },
  {
    icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: '资产工作台',
    desc: '上传的小说自动归档为个人资产，随时查看、复用或续转；所有数据与账户绑定，仅自己可见。',
  },
  {
    icon: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2',
    title: 'YAML 剧本导入',
    desc: '支持按剧本 schema 规范导入 .yaml 剧本，校验预览通过后直接生成结果页，兼容已有剧本资产。',
  },
];

const STEPS = [
  {
    no: '01',
    title: '上传小说',
    desc: '拖拽 .txt / .md 文件或直接粘贴文本，系统自动识别章节结构。',
    href: '/upload',
  },
  {
    no: '02',
    title: '配置转换',
    desc: '选择要转换的章节、AI 模型与输出参数，预览转换计划。',
    href: '/configure',
  },
  {
    no: '03',
    title: '查看剧本',
    desc: 'AI 逐章转换，进度实时可视化；完成后在结果页查看、导出与复盘。',
    href: '/guide',
  },
];

export const metadata = {
  title: 'Novel2Screenplay - 小说一键转专业剧本',
  description: 'AI 辅助剧本创作工具：上传小说，自动完成章节识别、角色/地点抽取与场景化重构，输出专业格式剧本。',
};

export default function HomePage() {
  return (
    <div className="animate-float-up space-y-14 sm:space-y-20">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-16 sm:px-12 sm:py-24 text-center">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-36 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <span className="tech-tag">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI 驱动
            </span>
            <span className="tech-tag tech-tag-cyan">小说 → 剧本</span>
            <span className="tech-tag">全流程可视化</span>
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight">
            把小说，变成
            <span className="neon-text">专业剧本</span>
          </h1>
          <p className="mt-6 text-slate-500 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto">
            Novel2Screenplay 是一款 AI 辅助剧本创作工作台：上传小说，自动完成章节识别、
            角色与地点抽取、场景化重构，输出符合行业规范的结构化剧本，全流程可追踪。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link href="/upload" className="glow-btn !px-8 !py-4 !text-base">
              免费开始使用
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link href="/features" className="glow-btn-ghost !px-8 !py-4 !text-base">
              查看功能介绍
            </Link>
          </div>
          <p className="mt-6 text-xs text-slate-400">无需安装 · 注册即用 · 数据与账户绑定</p>
        </div>
      </section>

      {/* ── 核心能力 ── */}
      <section>
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            核心能力<span className="neon-text">一览</span>
          </h2>
          <p className="text-slate-500 mt-2 text-sm sm:text-base">从原始小说到可拍摄剧本，每个环节都有 AI 加持</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="glass-card glass-card-hover p-6 rounded-2xl group">
              <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-400 text-white shadow-lg shadow-indigo-300/40 transition-transform duration-300 group-hover:scale-110">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                </svg>
              </span>
              <h3 className="mt-4 font-bold text-slate-900 text-lg">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 三步流程 ── */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-12 sm:px-12 sm:py-16">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none opacity-60" />
        <div className="relative">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              三步完成<span className="neon-text">转换</span>
            </h2>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">极简流程，几分钟内从小说得到剧本初稿</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.no} className="relative p-6 rounded-2xl bg-white/70 border border-slate-200/70 hover:shadow-xl hover:shadow-indigo-100/60 hover:-translate-y-1 transition-all duration-300">
                <span className="font-mono text-4xl font-extrabold bg-gradient-to-br from-indigo-600 to-cyan-400 bg-clip-text text-transparent">{s.no}</span>
                {i < STEPS.length - 1 && (
                  <svg className="hidden md:block absolute top-1/2 -right-5 w-5 h-5 text-cyan-400 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                )}
                <h3 className="mt-3 font-bold text-slate-900 text-lg">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-500 leading-relaxed">{s.desc}</p>
                <Link href={s.href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-600 hover:text-cyan-700 hover:underline">
                  了解更多
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 适用场景 ── */}
      <section>
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            为谁<span className="neon-text">而生</span>
          </h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: '编剧与创作者', desc: '把小说 IP 快速改编为剧本初稿，聚焦人物与对白打磨，而不是格式排版。' },
            { title: '影视从业者', desc: '用结构化剧本推进项目评估、分镜筹备与拍摄执行，全程可追踪、可复盘。' },
            { title: '内容团队', desc: '集中管理小说资产与转换历史，成员间分工协作，数据安全隔离。' },
          ].map((s) => (
            <div key={s.title} className="glass-card glass-card-hover p-6 rounded-2xl text-center">
              <h3 className="font-bold text-slate-900 text-lg">{s.title}</h3>
              <p className="mt-2 text-sm text-slate-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 底部 CTA ── */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-14 sm:px-12 text-center">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="pointer-events-none absolute -bottom-24 left-1/2 -translate-x-1/2 w-[36rem] h-36 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative">
          <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            准备好了吗？让小说<span className="neon-text">动起来</span>
          </h2>
          <p className="mt-4 text-slate-500 text-sm sm:text-base">注册账户，上传你的第一部小说，看看 AI 会怎样改编它。</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/auth/register" className="glow-btn !px-8 !py-4">立即注册</Link>
            <Link href="/upload" className="glow-btn-ghost !px-8 !py-4">直接体验</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

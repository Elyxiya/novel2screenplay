import Link from 'next/link';

const STEPS = [
  {
    no: '01',
    title: '注册 / 登录账户',
    duration: '约 1 分钟',
    desc: '点击右上角「注册」，用用户名（或可选邮箱）+ 密码创建账户，注册后自动登录。上传、转换与资产管理都绑定在你的账户下。',
    actions: [
      { label: '前往注册', href: '/auth/register' },
      { label: '前往登录', href: '/auth/login' },
    ],
  },
  {
    no: '02',
    title: '上传小说',
    duration: '约 1 分钟',
    desc: '在「上传」页拖拽 .txt / .md 文件到虚线区域，或直接把小说文本粘贴到文本框。系统会自动识别章节结构并展示章节清单。',
    points: ['文件最大 2MB；粘贴文本不限来源', '重复上传同名作品会自动并入资产并标记新增章节', '也可以切换到「上传 YAML」标签导入已有剧本'],
    actions: [
      { label: '前往上传', href: '/upload' },
    ],
  },
  {
    no: '03',
    title: '配置转换',
    duration: '约 1 分钟',
    desc: '在配置页勾选要转换的章节、选择 AI 模型与参数。已转换过的章节会自动标记，续转时默认只处理未完成部分。',
    actions: [
      { label: '前往配置', href: '/configure' },
    ],
  },
  {
    no: '04',
    title: '开始转换',
    duration: '按章节数量而定',
    desc: '点击开始后，AI 逐章将小说叙事重构为剧本结构。进度实时推送，可随时取消；中断后回到配置页可从未完成章节继续。',
    points: ['转换过程可离开页面，任务在服务端继续执行', '可在导航栏「历史」查看任务状态'],
  },
  {
    no: '05',
    title: '查看剧本结果',
    duration: '即时',
    desc: '转换完成后进入结果页：查看结构化剧本、场景 / 角色 / 地点统计，对转换质量进行复盘；不满意可回到配置页续转或重转。',
  },
  {
    no: '06',
    title: '管理资产与账户',
    duration: '随时',
    desc: '「工作台」集中管理你的小说资产与转换历史，可复用、续转或删除。右上角账户菜单提供账户设置，支持修改密码。',
    actions: [
      { label: '前往工作台', href: '/workbench' },
      { label: '账户设置', href: '/settings' },
    ],
  },
];

export const metadata = {
  title: '使用指南 - Novel2Screenplay',
  description: 'Novel2Screenplay 使用指南：注册登录、上传小说、配置转换、查看结果与资产管理，六步上手。',
};

export default function GuidePage() {
  return (
    <div className="animate-float-up space-y-10">
      {/* 页头 */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-12 sm:px-12 text-center">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
            <span className="tech-tag tech-tag-cyan">使用指南</span>
            <span className="tech-tag">六步上手</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            六步，从小说到<span className="neon-text">剧本</span>
          </h1>
          <p className="mt-4 text-slate-500 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
            注册账户 → 上传小说 → 配置转换 → 等待结果 → 复盘优化 → 资产管理。整个流程走完约 5 分钟。
          </p>
        </div>
      </section>

      {/* 步骤时间线 */}
      <section className="space-y-6">
        {STEPS.map((s, i) => (
          <div key={s.no} className="relative glass-card rounded-3xl p-6 sm:p-8 flex gap-5 sm:gap-8">
            {/* 编号 */}
            <div className="flex flex-col items-center shrink-0">
              <span className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-cyan-400 text-white font-extrabold text-lg sm:text-xl shadow-lg shadow-indigo-300/40">
                {s.no}
              </span>
              {i < STEPS.length - 1 && (
                <span className="w-px flex-1 min-h-6 my-2 bg-gradient-to-b from-cyan-400/60 to-transparent" />
              )}
            </div>
            {/* 内容 */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">{s.title}</h2>
                {s.duration && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-cyan-50 border border-cyan-200/70 text-cyan-700 text-xs">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {s.duration}
                  </span>
                )}
              </div>
              <p className="mt-3 text-slate-500 text-sm sm:text-base leading-relaxed">{s.desc}</p>
              {s.points && (
                <ul className="mt-4 space-y-2">
                  {s.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-slate-600">
                      <svg className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              {s.actions && (
                <div className="mt-5 flex flex-wrap gap-3">
                  {s.actions.map((a) => (
                    <Link key={a.href + a.label} href={a.href} className={a.label.includes('登录') ? 'glow-btn-ghost !py-2.5' : 'glow-btn !py-2.5'}>
                      {a.label}
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* 提示 */}
      <section className="glass-card rounded-3xl p-6 sm:p-8 border-l-4 !border-l-cyan-400">
        <div className="flex gap-4">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <div>
            <h3 className="font-bold text-slate-900">小贴士</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600 leading-relaxed">
              <li>· 首次使用建议先注册账户，否则无法上传与保存资产。</li>
              <li>· 长篇小说建议分批上传或使用「续转」能力增量转换，避免一次转换过久。</li>
              <li>· 对转换结果不满意，可回到配置页重新选择章节与模型再次转换，历史记录都会保留。</li>
              <li>· 已有 YAML 剧本可通过「上传 YAML」标签直接导入并查看。</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 底部 CTA */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-12 text-center">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="relative">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">开始你的第一部改编</h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <Link href="/upload" className="glow-btn !px-8 !py-3.5">立即上传</Link>
            <Link href="/features" className="glow-btn-ghost !px-8 !py-3.5">回看功能介绍</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

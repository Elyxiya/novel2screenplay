import Link from 'next/link';

const FEATURE_SECTIONS = [
  {
    id: 'chapter',
    icon: 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
    title: '自动章节识别',
    tagline: '上传即解析，章节结构秒级呈现',
    desc: '支持拖拽 .txt / .md 文件或直接粘贴文本，系统自动完成章节切分、标题识别与段落统计，为后续逐章转换打好基础。',
    points: [
      '拖拽上传或粘贴文本双通道，最大支持 2MB',
      '自动识别章节标题与正文边界，段落数、字数一目了然',
      '重复上传同一作品时自动并入资产并识别新增章节',
      '已转换章节自动标记，续转默认只处理未转换部分',
    ],
  },
  {
    id: 'convert',
    icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z',
    title: 'AI 场景化重构',
    tagline: '小说叙事 → 标准剧本结构',
    desc: 'AI 引擎逐章分析小说内容，将叙述性文字重构为剧本语言：场景标题、内/外景与时间标注、角色动作、对白与旁白分层呈现。',
    points: [
      '逐章独立转换，长篇小说也能稳定推进',
      '输出标准剧本结构：场景、角色动作、对白、舞台指示',
      '进度实时流式推送，转换过程全程可见',
      '支持取消与续转，中断后可从未完成章节继续',
    ],
  },
  {
    id: 'stats',
    icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
    title: '角色 / 地点识别',
    tagline: '人物与场景，结构化呈现',
    desc: '转换结果自动统计场景总数、角色清单与地点清单，帮助创作者快速掌握剧本的人物关系与场景布局，无需逐页翻阅。',
    points: [
      '场景、角色、地点三维度自动统计',
      '角色清单辅助把握人物出场与关系网络',
      '地点清单辅助筹备勘景与拍摄计划',
      '统计结果随结果页统一展示，支持随时复盘',
    ],
  },
  {
    id: 'model',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: '灵活转换配置',
    tagline: '章节、模型、参数自由组合',
    desc: '转换前可自由选择参与转换的章节、AI 模型与相关参数，按内容难度与风格需求灵活调整，先预览计划再执行。',
    points: [
      '逐章勾选，可按需只转换指定章节',
      '多模型可选，适配不同风格与预算',
      '转换计划先预览后执行，避免误操作',
      '支持多轮增量转换，边写边转',
    ],
  },
  {
    id: 'workbench',
    icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    title: '资产工作台',
    tagline: '小说资产持久化，随时续转',
    desc: '上传的小说自动归档为个人资产，与账户绑定并持久化保存。再次上传相同作品可自动续转新增章节，历史记录随时回看。',
    points: [
      '小说资产云端持久化，换设备不丢失',
      '同名作品自动合并，增量续转新增章节',
      '转换历史完整留存，随时回看结果',
      '数据与账户绑定，多用户之间严格隔离',
    ],
  },
  {
    id: 'yaml',
    icon: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2',
    title: 'YAML 剧本导入',
    tagline: '已有剧本资产无缝接入',
    desc: '支持按剧本 schema 规范导入 .yaml / .yml 文件，上传即校验、预览场景/角色/地点统计，确认后直接生成结构化剧本。',
    points: [
      '严格 schema 校验，错误定位到具体字段',
      '导入前预览统计，确认无误再提交',
      '支持拖拽与粘贴两种输入方式',
      '兼容已有 YAML 剧本资产，零迁移成本',
    ],
  },
];

export const metadata = {
  title: '功能介绍 - Novel2Screenplay',
  description: 'Novel2Screenplay 核心功能详解：自动章节识别、AI 场景化重构、角色地点识别、灵活配置、资产工作台与 YAML 导入。',
};

export default function FeaturesPage() {
  return (
    <div className="animate-float-up space-y-10">
      {/* 页头 */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-12 sm:px-12 text-center">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="relative">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
            <span className="tech-tag tech-tag-cyan">功能介绍</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-slate-900">
            从小说到剧本，<span className="neon-text">一步到位</span>
          </h1>
          <p className="mt-4 text-slate-500 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed">
            Novel2Screenplay 围绕「小说改编剧本」这一场景，提供六大核心能力。每一项都可独立使用，也可串成全流程流水线。
          </p>
        </div>
      </section>

      {/* 功能分区 */}
      {FEATURE_SECTIONS.map((f, i) => (
        <section
          key={f.id}
          id={f.id}
          className={`glass-card rounded-3xl p-6 sm:p-10 ${i % 2 === 1 ? 'sm:bg-gradient-to-br sm:from-indigo-50/40 sm:to-cyan-50/30' : ''}`}
        >
          <div className={`grid gap-8 md:grid-cols-2 md:items-center ${i % 2 === 1 ? 'md:[direction:rtl]' : ''}`}>
            {/* 文案 */}
            <div className="md:[direction:ltr]">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-cyan-400 text-white shadow-lg shadow-indigo-300/40">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.icon} />
                  </svg>
                </span>
                <span className="font-mono text-xs text-slate-400">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">{f.title}</h2>
              <p className="mt-1 text-sm font-medium text-cyan-600">{f.tagline}</p>
              <p className="mt-4 text-slate-500 text-sm sm:text-base leading-relaxed">{f.desc}</p>
            </div>
            {/* 要点清单 */}
            <ul className="md:[direction:ltr] space-y-3">
              {f.points.map((p) => (
                <li key={p} className="flex items-start gap-3 p-3.5 rounded-xl bg-white/70 border border-slate-200/70 hover:border-cyan-300/50 transition-colors">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-sm text-slate-600 leading-relaxed">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      {/* 底部 CTA */}
      <section className="relative overflow-hidden rounded-3xl glass-card px-6 py-12 text-center">
        <div className="absolute inset-0 bg-tech-grid pointer-events-none" />
        <div className="relative">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
            想亲手试试这些能力？
          </h2>
          <p className="mt-3 text-slate-500 text-sm sm:text-base">上传你的第一部小说，几分钟后就能看到结构化剧本。</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            <Link href="/upload" className="glow-btn !px-8 !py-3.5">开始使用</Link>
            <Link href="/guide" className="glow-btn-ghost !px-8 !py-3.5">查看使用指南</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

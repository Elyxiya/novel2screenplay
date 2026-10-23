'use client';

import Link from 'next/link';

export type WorkflowStepKey = 'upload' | 'configure' | 'convert' | 'done';

const STEPS: Array<{ key: WorkflowStepKey; label: string; desc: string; href: string }> = [
  { key: 'upload', label: '上传小说', desc: '拖入或粘贴文本', href: '/upload' },
  { key: 'configure', label: '转换配置', desc: '选章节与模型', href: '/configure' },
  { key: 'convert', label: '开始转换', desc: 'AI 场景化处理', href: '/convert' },
];

interface WorkflowStepperProps {
  current: WorkflowStepKey;
  className?: string;
  /** 完成态：转换完成后的结果页显示 */
  completed?: boolean;
}

/**
 * 全流程 3 步向导引导条
 * 在首页 / 配置页 / 转换页 / 结果页统一展示，明确用户当前所处环节。
 * 每个步骤都可点击跳转到对应环节，避免「上传功能藏得太深找不到」。
 */
export function WorkflowStepper({ current, className = '', completed = false }: WorkflowStepperProps) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  // 转换完成后，所有步骤都视为完成
  const done = completed;

  return (
    <div className={`flex items-center w-full ${className}`}>
      {STEPS.map((step, i) => {
        const isDone = done || i < currentIdx;
        const isActive = !done && i === currentIdx;
        const showConnector = i < STEPS.length - 1;
        const canGoBack = i < currentIdx;

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            {/* 步骤项：可点击跳转 */}
            <Link
              href={step.href}
              className={`flex items-center gap-2.5 rounded-xl px-2 py-1 -m-1 transition-all duration-300 group ${
                isActive
                  ? 'cursor-default'
                  : `cursor-pointer ${canGoBack ? 'hover:bg-white/5' : 'hover:bg-white/5'}`
              }`}
              aria-label={`前往${step.label}`}
            >
              <span
                className={`step-badge ${
                  isDone ? 'step-badge-done' : isActive ? 'step-badge-active' : 'step-badge-idle'
                } ${
                  !isActive && canGoBack
                    ? 'group-hover:shadow group-hover:shadow-[rgba(var(--accent-rgb),0.3)]'
                    : ''
                }`}
              >
                {isDone ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <div className="hidden sm:block text-left">
                <p className={`text-sm font-semibold leading-tight ${isActive ? 'text-white' : isDone ? 'text-ink-muted' : canGoBack ? 'text-ink-muted group-hover:text-white' : 'text-ink-faint'}`}>
                  {step.label}
                </p>
                <p className={`text-xs leading-tight mt-0.5 ${isActive ? 'text-[var(--accent)]' : isDone ? 'text-emerald-400' : 'text-ink-faint'}`}>
                  {isActive ? `当前：${step.desc}` : canGoBack ? `${step.desc} · 点击返回` : step.desc}
                </p>
              </div>
              {/* 移动端仅显示编号徽章 */}
              <span className="sm:hidden text-xs font-medium text-ink-muted">{step.label}</span>
            </Link>

            {/* 连接线 */}
            {showConnector && (
              <span className={`step-connector ${isDone ? 'step-connector-done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 步骤状态钩子：根据 pathname 判断当前步骤 */
export function getStepFromPath(pathname: string): WorkflowStepKey {
  if (pathname?.startsWith('/result/')) return 'convert';
  if (pathname === '/convert') return 'convert';
  if (pathname === '/configure') return 'configure';
  if (pathname === '/upload') return 'upload';
  return 'upload';
}
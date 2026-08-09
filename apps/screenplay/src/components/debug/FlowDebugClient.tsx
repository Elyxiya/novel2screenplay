'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import type { FlowEvaluation } from '@/lib/debug/flow-evaluator';

/**
 * 流程调试与评测页面
 *
 * - 输入 jobId，拉取 /api/debug/flow-eval 评测结果
 * - 展示总分、四维评分、4 阶段流水线视图、场景置信度分布、问题列表
 * - 可选拉取 /api/debug/agent-logs 展示 LLM 对话日志
 */

const PHASE_LABELS: Record<string, { name: string; desc: string }> = {
  analyze: { name: 'Phase 1 · 分析', desc: '角色 / 地点 / 时间线提取' },
  segment: { name: 'Phase 2 · 切分', desc: '章节 → 场景边界' },
  convert: { name: 'Phase 3 · 转换', desc: '场景 → 剧本（并行）' },
  merge: { name: 'Phase 4 · 合并', desc: '合并校验 + YAML' },
  efficiency: { name: 'Token 效率', desc: '上下文裁剪 / 成本控制' },
};

function fmtDuration(ms?: number): string {
  if (ms === undefined) return '未知';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtMetrics(metrics: Record<string, string | number>): string {
  return Object.entries(metrics)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

interface AgentLogEntry {
  type: string;
  level: string;
  data: Record<string, unknown>;
}

export function FlowDebugClient() {
  const searchParams = useSearchParams();
  const initialJobId = searchParams.get('jobId') ?? '';
  const [jobId, setJobId] = useState(initialJobId);
  const [input, setInput] = useState(initialJobId);
  const [evaluation, setEvaluation] = useState<FlowEvaluation | null>(null);
  const [logs, setLogs] = useState<AgentLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showLogs, setShowLogs] = useState(false);

  const run = useCallback(
    async (targetId: string) => {
      if (!targetId) {
        setError('请输入 jobId');
        return;
      }
      setLoading(true);
      setError('');
      setEvaluation(null);
      setLogs(null);
      void (async () => {
        try {
          const res = await fetch(`/api/debug/flow-eval?jobId=${encodeURIComponent(targetId)}`);
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            setError((body as { error?: string }).error ?? `请求失败 (${res.status})`);
            return;
          }
          const data = await res.json();
          setEvaluation(data.evaluation);
        } catch {
          setError('评测请求失败');
        } finally {
          setLoading(false);
        }
      })();
    },
    [],
  );

  const loadLogs = useCallback(async () => {
    if (!jobId) return;
    setShowLogs((v) => !v);
    if (showLogs || logs) return;
    void (async () => {
      try {
        const res = await fetch(`/api/debug/agent-logs?taskId=${encodeURIComponent(jobId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const session = data.session;
        if (session?.entries?.length) {
          setLogs(session.entries as AgentLogEntry[]);
        }
      } catch {
        // 对话日志为可选增强，失败静默
      }
    })();
  }, [jobId, showLogs, logs]);

  const eval_ = evaluation;
  const dims = eval_?.overall.dimensions;

  // URL 携带 jobId 时自动触发评测（分享直达）
  useEffect(() => {
    if (initialJobId) void run(initialJobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const gradeColors: Record<string, string> = {
    excellent: '#0F9D58',
    good: '#22A5F7',
    fair: '#F5A623',
    poor: '#E5484D',
  };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 48px', fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif', color: '#171717' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px' }}>流程调试与评测</h1>
      <p style={{ fontSize: 13, color: '#52525B', margin: '0 0 16px' }}>
        输入转换任务 ID，查看四阶段流水线的产物与效果评分
      </p>

      {/* 查询栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入 jobId（如 job_xxx）"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setJobId(input);
              void run(input);
            }
          }}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #D4D4D8',
            borderRadius: 8,
            fontSize: 14,
          }}
        />
        <button
          onClick={() => {
            setJobId(input);
            void run(input);
          }}
          style={{
            padding: '8px 20px',
            background: '#4B3FE3',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          评测
        </button>
      </div>

      {loading && <div style={{ color: '#52525B', fontSize: 14 }}>评测中...</div>}
      {error && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 14, color: '#B91C1C', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {eval_ && dims && (
        <>
          {/* 总评分卡 */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, background: '#FAFAFA', border: '1px solid #E4E4E7', borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ textAlign: 'center', alignSelf: 'center' }}>
              <div style={{ fontSize: 13, color: '#52525B', marginBottom: 4 }}>整体评分</div>
              <div style={{ fontSize: 44, fontWeight: 700, color: gradeColors[eval_.overall.grade] ?? '#171717', lineHeight: 1 }}>
                {eval_.overall.score}
              </div>
              <div
                style={{
                  display: 'inline-block',
                  marginTop: 8,
                  padding: '2px 10px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#fff',
                  background: gradeColors[eval_.overall.grade] ?? '#71717A',
                }}
              >
                {eval_.overall.grade}
              </div>
              <div style={{ fontSize: 12, color: '#71717A', marginTop: 8 }}>
                {eval_.status}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
              {(
                [
                  ['format', '结构完整', dims.format],
                  ['consistency', '引用一致', dims.consistency],
                  ['coherence', '叙事连贯', dims.coherence],
                  ['drama', '戏剧张力', dims.drama],
                  ['efficiency', 'Token 效率', dims.efficiency],
                ] as const
              ).map(([key, label, value]) => (
                <div key={key}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#52525B', marginBottom: 2 }}>
                    <span>{label}</span>
                    <span>{value}</span>
                  </div>
                  <div style={{ height: 8, background: '#E4E4E7', borderRadius: 999, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${value}%`,
                        background: key === 'format' ? '#4B3FE3' : '#3C2ECA',
                        borderRadius: 999,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 流水线视图 */}
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>流水线各阶段</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
            {(
              [
                ['analyze', eval_.phases.analyze],
                ['segment', eval_.phases.segment],
                ['convert', eval_.phases.convert],
                ['merge', eval_.phases.merge],
                ['efficiency', eval_.phases.efficiency],
              ] as const
            ).map(([key, phase]) => {
              const label = PHASE_LABELS[key];
              const statusColor =
                phase.status === 'ok' ? '#0F9D58' : phase.status === 'warn' ? '#F5A623' : '#E5484D';
              return (
                <div
                  key={key}
                  style={{
                    border: `1px solid ${phase.status === 'empty' ? '#D4D4D8' : statusColor}44`,
                    borderRadius: 10,
                    padding: 14,
                    background: '#fff',
                    borderLeft: `3px solid ${phase.status === 'empty' ? '#A1A1AA' : statusColor}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{label.name}</div>
                  <div style={{ fontSize: 12, color: '#71717A', marginBottom: 8 }}>{label.desc}</div>
                  {phase.status === 'empty' ? (
                    <div style={{ fontSize: 12, color: '#A1A1AA' }}>未执行 / 无产物</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: '#52525B', marginBottom: 4 }}>{fmtMetrics(phase.metrics)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: statusColor }}>{phase.score}</span>
                        <span style={{ fontSize: 12, color: '#71717A' }}>分</span>
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#71717A' }}>
                          {fmtDuration(eval_.stats.phaseTimings[key]?.durationMs)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* 统计 + 问题列表 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ background: '#FAFAFA', border: '1px solid #E4E4E7', borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>关键统计</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                <div><span style={{ color: '#71717A' }}>总场景数</span> <b>{eval_.stats.totalScenes}</b></div>
                <div><span style={{ color: '#71717A' }}>平均置信度</span> <b>{eval_.stats.sceneConfidence.avg}</b></div>
                <div><span style={{ color: '#71717A' }}>低置信度</span> <b>{eval_.stats.sceneConfidence.lowCount}/{eval_.stats.sceneConfidence.total}</b></div>
                <div><span style={{ color: '#71717A' }}>对白占比</span> <b>{eval_.stats.dialoguePercentage ?? '未知'}%</b></div>
                <div><span style={{ color: '#71717A' }}>动作占比</span> <b>{eval_.stats.actionPercentage ?? '未知'}%</b></div>
                <div><span style={{ color: '#71717A' }}>总耗时</span> <b>
                  {(() => {
                    const timings = Object.values(eval_.stats.phaseTimings);
                    return timings.length ? fmtDuration(timings.reduce((a, b) => a + b.durationMs, 0)) : '未知';
                  })()}
                </b></div>
                {eval_.stats.usage && (
                  <>
                    <div><span style={{ color: '#71717A' }}>LLM 调用</span> <b>{eval_.stats.usage.calls} 次</b></div>
                    <div><span style={{ color: '#71717A' }}>Token 用量</span> <b>{eval_.stats.usage.totalTokens.toLocaleString()}（入 {eval_.stats.usage.promptTokens.toLocaleString()} / 出 {eval_.stats.usage.completionTokens.toLocaleString()}）</b></div>
                    <div><span style={{ color: '#71717A' }}>每字 Token</span> <b>{eval_.stats.usage.tokensPerChar ?? '未知'}</b></div>
                  </>
                )}
              </div>
              {/* 场景置信度分布（0-1 分桶条形） */}
              {(() => {
                const buckets = eval_.stats.sceneConfidence.buckets;
                const total = buckets.reduce((a, b) => a + b, 0);
                if (total === 0) {
                  return (
                    <div style={{ marginTop: 12, borderTop: '1px solid #E4E4E7', paddingTop: 10 }}>
                      <div style={{ fontSize: 12, color: '#71717A', marginBottom: 4 }}>场景置信度分布</div>
                      <div style={{ fontSize: 12, color: '#A1A1AA' }}>无置信度数据</div>
                    </div>
                  );
                }
                const maxCount = Math.max(...buckets, 1);
                return (
                  <div style={{ marginTop: 12, borderTop: '1px solid #E4E4E7', paddingTop: 10 }}>
                    <div style={{ fontSize: 12, color: '#71717A', marginBottom: 6 }}>场景置信度分布（0-1 分桶）</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 60 }}>
                      {buckets.map((count, i) => {
                        const h = Math.max(4, Math.round((count / maxCount) * 44));
                        const low = i < 3; // 0.6 以下视为低置信度
                        return (
                          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: low ? '#B45309' : '#0F9D58' }}>{count}</div>
                            <div style={{ width: '100%', maxWidth: 30, height: h, background: low ? '#F5A623' : '#22A5F7', borderRadius: '4px 4px 0 0' }} />
                            <div style={{ fontSize: 10, color: '#71717A' }}>{`${(i * 0.2).toFixed(1)}-${((i + 1) * 0.2).toFixed(1)}`}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div style={{ background: '#FAFAFA', border: '1px solid #E4E4E7', borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>
                问题与建议 ({eval_.issues.length})
              </h3>
              {eval_.issues.length === 0 ? (
                <div style={{ fontSize: 13, color: '#0F9D58' }}>未发现问题</div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {eval_.issues.map((iss, i) => (
                    <li key={i} style={{ fontSize: 13, color: iss.level === 'error' ? '#B91C1C' : '#B45309' }}>
                      <b>[{iss.phase}]</b> {iss.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 对话日志联动 */}
          <button
            onClick={() => void loadLogs()}
            style={{
              padding: '8px 16px',
              border: '1px solid #D4D4D8',
              borderRadius: 8,
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            {showLogs ? '收起 LLM 对话日志' : '展开 LLM 对话日志'}
          </button>
          {showLogs && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {logs && logs.length > 0 ? (
                logs.map((entry, i) => (
                  <div key={i} style={{ border: '1px solid #E4E4E7', borderRadius: 8, padding: '10px 12px', fontSize: 13, background: entry.type === 'llm_request' ? '#FAFAFA' : '#fff' }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {entry.type === 'llm_request' ? '→ 请求' : entry.type === 'llm_response' ? '← 响应' : entry.type}
                      {entry.data.phase ? ` · ${String(entry.data.phase)}` : ''}
                      {entry.data.model ? ` · ${String(entry.data.model)}` : ''}
                    </div>
                    <div style={{ color: '#52525B', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflow: 'auto' }}>
                      {typeof entry.data.content === 'string'
                        ? entry.data.content.slice(0, 600)
                        : entry.data.error
                          ? String(entry.data.error)
                          : JSON.stringify(entry.data).slice(0, 400)}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 13, color: '#A1A1AA' }}>
                  未找到该任务的对话日志（传统管线可能未走 Agent 编排器）
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

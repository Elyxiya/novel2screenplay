'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';

/**
 * 执行时间线（P1 观测层）
 *
 * 数据源：GET /api/debug/jobs/:jobId/events
 * 作用：把「一次转换坏在哪」从一句「流水线失败」变成可定位的证据——
 * 哪个阶段最慢、哪个场景重试了、哪一章降级了、当时的输入输出是什么。
 */

interface RunEventDto {
  id: string;
  traceId: string;
  phase: number;
  sceneIndex: number | null;
  stage: string;
  event: string;
  level: 'info' | 'warn' | 'error';
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: number;
  payload: Record<string, unknown> | null;
}

interface ArtifactDto {
  id: string;
  traceId: string;
  stage: string;
  sceneIndex: number | null;
  attempt: number;
  createdAt: number;
  meta: Record<string, unknown> | null;
  inputText: string | null;
  outputText: string | null;
}

interface StageSummaryDto {
  stage: string;
  phase: number;
  count: number;
  errors: number;
  warns: number;
  totalLatencyMs: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  promptTokens: number;
  completionTokens: number;
}

interface EventsResponse {
  jobId: string;
  status: string;
  currentPhase: number | null;
  summary: StageSummaryDto[];
  events: RunEventDto[];
  artifacts: ArtifactDto[];
}

function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function levelColor(level: string): string {
  if (level === 'error') return '#B91C1C';
  if (level === 'warn') return '#B45309';
  return '#52525B';
}

const cell: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #E4E4E7', fontSize: 12 };
const headCell: CSSProperties = { ...cell, color: '#71717A', fontWeight: 600, textAlign: 'left' };

export function StageTimeline({ jobId }: { jobId: string }) {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);

  const load = useCallback(async (targetId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/debug/jobs/${encodeURIComponent(targetId)}/events`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `请求失败 (${res.status})`);
        setData(null);
        return;
      }
      setData((await res.json()) as EventsResponse);
    } catch {
      setError('时间线请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    queueMicrotask(() => {
      if (alive) void load(jobId);
    });
    return () => {
      alive = false;
    };
  }, [jobId, load]);

  if (!jobId) return null;

  const events = data?.events ?? [];
  const interesting = events.filter((e) => e.level !== 'info' || e.event === 'retry' || e.event === 'degrade');
  const listed = showAllEvents ? events : interesting;
  const artifacts = data?.artifacts ?? [];

  return (
    <section style={{ border: '1px solid #E4E4E7', borderRadius: 12, padding: 16, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          执行时间线
          {data ? (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#71717A' }}>
              {data.status} · 事件 {events.length} 条 · 产物 {artifacts.length} 份
            </span>
          ) : null}
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {loading ? <span style={{ fontSize: 12, color: '#71717A' }}>加载中…</span> : null}
          <button
            onClick={() => void load(jobId)}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer', border: '1px solid #D4D4D8', background: 'transparent' }}
          >
            刷新
          </button>
        </div>
      </div>

      {error ? <div style={{ color: '#B91C1C', fontSize: 13 }}>{error}</div> : null}

      {data && data.summary.length === 0 ? (
        <div style={{ fontSize: 13, color: '#71717A' }}>
          该任务没有运行事件。旧任务（观测层上线前创建）不会回溯补数据，重新转换一次即可看到。
        </div>
      ) : null}

      {data && data.summary.length > 0 ? (
        <>
          <h3 style={{ fontSize: 13, color: '#52525B', margin: '4px 0 6px' }}>阶段耗时与错误</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
            <thead>
              <tr>
                <th style={headCell}>阶段</th>
                <th style={headCell}>事件数</th>
                <th style={headCell}>错误 / 警告</th>
                <th style={headCell}>P50</th>
                <th style={headCell}>P95</th>
                <th style={headCell}>Token（入 / 出）</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((s) => (
                <tr key={s.stage}>
                  <td style={{ ...cell, fontFamily: 'monospace' }}>{s.stage}</td>
                  <td style={cell}>{s.count}</td>
                  <td style={{ ...cell, color: s.errors > 0 ? '#B91C1C' : s.warns > 0 ? '#B45309' : '#52525B' }}>
                    {s.errors} / {s.warns}
                  </td>
                  <td style={cell}>{fmtMs(s.p50LatencyMs)}</td>
                  <td style={cell}>{fmtMs(s.p95LatencyMs)}</td>
                  <td style={cell}>
                    {s.promptTokens} / {s.completionTokens}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h3 style={{ fontSize: 13, color: '#52525B', margin: 0 }}>
              {showAllEvents ? '全部事件' : '异常与降级事件'}
            </h3>
            <button
              onClick={() => setShowAllEvents((v) => !v)}
              style={{ padding: '2px 8px', fontSize: 12, borderRadius: 6, cursor: 'pointer', border: '1px solid #D4D4D8', background: 'transparent' }}
            >
              {showAllEvents ? '只看异常' : '展开全部'}
            </button>
          </div>

          {listed.length === 0 ? (
            <div style={{ fontSize: 12, color: '#71717A' }}>没有异常事件。</div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #F4F4F5', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {listed.slice(0, 300).map((e) => (
                    <tr key={e.id}>
                      <td style={{ ...cell, width: 78, color: '#A1A1AA', fontFamily: 'monospace' }}>{fmtTime(e.createdAt)}</td>
                      <td style={{ ...cell, width: 150, fontFamily: 'monospace' }}>{e.stage}</td>
                      <td style={{ ...cell, width: 60, color: '#A1A1AA' }}>{e.sceneIndex === null ? '—' : `#${e.sceneIndex}`}</td>
                      <td style={{ ...cell, width: 70, color: levelColor(e.level) }}>{e.event}</td>
                      <td style={{ ...cell, width: 60 }}>{fmtMs(e.latencyMs)}</td>
                      <td style={{ ...cell, wordBreak: 'break-all', color: '#3F3F46' }}>
                        {e.payload ? JSON.stringify(e.payload).slice(0, 220) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {artifacts.length > 0 ? (
            <>
              <h3 style={{ fontSize: 13, color: '#52525B', margin: '14px 0 6px' }}>
                阶段产物快照（失败/降级全留，成功按采样）
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {artifacts.slice(0, 40).map((a) => (
                  <div key={a.id} style={{ border: '1px solid #F4F4F5', borderRadius: 8 }}>
                    <button
                      onClick={() => setOpenArtifact((cur) => (cur === a.id ? null : a.id))}
                      style={{
                        width: '100%', display: 'flex', gap: 10, alignItems: 'center',
                        padding: '6px 10px', background: 'transparent', border: 'none',
                        cursor: 'pointer', textAlign: 'left', fontSize: 12,
                      }}
                    >
                      <span style={{ fontFamily: 'monospace', color: '#3F3F46' }}>{a.stage}</span>
                      <span style={{ color: '#A1A1AA' }}>{a.sceneIndex === null ? '—' : `场景 #${a.sceneIndex}`}</span>
                      <span style={{ color: '#71717A' }}>
                        {a.meta && 'confidence' in a.meta ? `置信度 ${String(a.meta.confidence)}` : ''}
                      </span>
                      <span style={{ marginLeft: 'auto', color: '#A1A1AA' }}>{openArtifact === a.id ? '收起' : '查看'}</span>
                    </button>
                    {openArtifact === a.id ? (
                      <div style={{ padding: '0 10px 10px' }}>
                        <div style={{ fontSize: 11, color: '#71717A', margin: '4px 0 2px' }}>输入</div>
                        <pre style={{ margin: 0, maxHeight: 160, overflow: 'auto', background: '#FAFAFA', padding: 8, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>
                          {a.inputText ?? '（未记录）'}
                        </pre>
                        <div style={{ fontSize: 11, color: '#71717A', margin: '8px 0 2px' }}>输出</div>
                        <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', background: '#FAFAFA', padding: 8, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>
                          {a.outputText ?? '（未记录）'}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

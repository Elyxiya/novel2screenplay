/**
 * 结果页局部追问（L2）：对已产出剧本的指定场景（或全部场景）按自然语言指令重生成。
 * POST /api/result/revise  { jobId, sceneNumber?, instruction, scope?: 'scene' | 'all' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { jobStore } from '@/lib/store/job-store';
import { serializeToYaml, safeParseFromYaml } from '@novel/contracts/serializers';
import { getCurrentUser, authError } from '@/lib/auth';
import { initializeProviders } from '@/lib/llm/registry';
import { resolveProvider } from '@/lib/llm/llm-gateway';
import { reviseScene, reviseSceneStream } from '@/lib/result/revise-scene';
import type { Scene, Screenplay } from '@novel/contracts/screenplay';

// 模块级初始化 LLM Provider 注册表（与其他 pipeline/agent route 一致，幂等）
initializeProviders();

/** 从章节原文中定位某场戏对应的小说片段（优先章区间，回退 sourceRefs 章节） */
function deriveSourceText(chapterTexts: string[], scene: Scene): string {
  if (scene.sourceChapterRange) {
    const [start, end] = scene.sourceChapterRange;
    return chapterTexts.slice(start, end + 1).join('\n\n');
  }
  const chapters = new Set<number>();
  for (const block of scene.content) {
    for (const ref of block.sourceRefs ?? []) chapters.add(ref.chapterIndex);
  }
  return [...chapters]
    .sort((a, b) => a - b)
    .map((i) => chapterTexts[i] ?? '')
    .join('\n\n');
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return authError();

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  const scope = body?.scope === 'all' ? 'all' : 'scene';
  const sceneNumber = typeof body?.sceneNumber === 'number' ? body.sceneNumber : undefined;

  if (!jobId) return NextResponse.json({ error: '缺少 jobId' }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: '缺少修改意见 instruction' }, { status: 400 });

  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.userId && job.userId !== user.id) return NextResponse.json({ error: '无权访问' }, { status: 403 });

  const screenplay = job.pipelineState?.phase4Output as Screenplay | undefined;
  if (job.status !== 'completed' || !screenplay) {
    return NextResponse.json({ error: '任务尚未产出剧本' }, { status: 400 });
  }

  const targets = scope === 'all' ? screenplay.scenes : screenplay.scenes.filter((s) => s.sceneNumber === sceneNumber);
  if (targets.length === 0) return NextResponse.json({ error: '未找到目标场景' }, { status: 404 });

  // 用户导入的自定义 LLM 优先，未匹配回退全局 env；job 记录的 modelId 关联
  const provider = resolveProvider(user.id, job.config?.modelId);
  if (!provider) return NextResponse.json({ error: '未配置 LLM Provider' }, { status: 400 });

  // 角色名（含别名）→ characterId，供归一化模型输出的 speaker 字段
  const nameToCharacterId: Record<string, string> = {};
  for (const c of screenplay.characters) {
    nameToCharacterId[c.name] = c.characterId;
    for (const alias of c.aliases) nameToCharacterId[alias] = c.characterId;
  }

  // 单场景 + ?stream=1：NDJSON 流式（逐 delta 预览，done 原子落库）
  const streamed = new URL(request.url).searchParams.get('stream') === '1';
  if (streamed && scope === 'scene') {
    const scene = targets[0];
    const sourceText = deriveSourceText(job.chapterTexts ?? [], scene);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (obj: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
          } catch {
            /* 已关闭，忽略 */
          }
        };
        try {
          let hasFull = false;
          for await (const out of reviseSceneStream(sourceText, scene, instruction, { provider, nameToCharacterId })) {
            if ('delta' in out) {
              enqueue({ delta: out.delta });
              continue;
            }
            const updated = JSON.parse(JSON.stringify(screenplay)) as Screenplay;
            const idx = updated.scenes.findIndex((s) => s.sceneNumber === scene.sceneNumber);
            if (idx >= 0) updated.scenes[idx] = out.full;
            const yaml = serializeToYaml(updated);
            const parsed = safeParseFromYaml(yaml);
            if (!parsed.success) throw new Error(`校验失败: ${parsed.error}`);
            jobStore.update(jobId, (j) => ({ ...j, pipelineState: { ...j.pipelineState, phase4Output: parsed.data } }));
            enqueue({ done: true, message: `场景 ${scene.sceneNumber} 已按建议更新`, scene: out.full });
            hasFull = true;
          }
          if (!hasFull) enqueue({ error: '场景重生成失败' });
        } catch (err) {
          enqueue({ error: err instanceof Error ? err.message : '场景重生成失败' });
        } finally {
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        }
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // 非流式路径：单场景走 reviseScene，scope:'all' 走全量（逐场景更新）
  const updated = JSON.parse(JSON.stringify(screenplay)) as Screenplay;
  const changed: Scene[] = [];
  for (const scene of targets) {
    const sourceText = deriveSourceText(job.chapterTexts ?? [], scene);
    const next = await reviseScene(sourceText, scene, instruction, { provider, nameToCharacterId });
    const idx = updated.scenes.findIndex((s) => s.sceneNumber === scene.sceneNumber);
    if (idx >= 0) updated.scenes[idx] = next;
    changed.push(next);
  }

  const yaml = serializeToYaml(updated);
  const parsed = safeParseFromYaml(yaml);
  if (!parsed.success) {
    return NextResponse.json({ error: `重生成结果校验失败: ${parsed.error}` }, { status: 400 });
  }

  jobStore.update(jobId, (j) => ({ ...j, pipelineState: { ...j.pipelineState, phase4Output: parsed.data } }));

  return NextResponse.json({
    success: true,
    message: scope === 'all' ? `已按建议重生成 ${changed.length} 个场景` : `场景 ${sceneNumber} 已按建议更新`,
    scene: changed[0],
    totalUpdated: changed.length,
  });
}

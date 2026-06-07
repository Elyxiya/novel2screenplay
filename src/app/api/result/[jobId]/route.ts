import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jobStore } from '@/lib/store/job-store';
import { serializeToYaml, safeParseFromYaml } from '@/lib/schema/yaml-serializer';
import type { Screenplay } from '@/lib/schema/screenplay.schema';

type ZodIssue = { path: (string | number)[]; message: string };

function extractZodIssues(error: string, issues: ZodIssue[]): string {
  if (!issues.length) return error;
  return issues.map(iss => {
    const path = iss.path.join('.').replace(/^scenes.\d+\./, 'scene:');
    return `[${path}] ${iss.message}`;
  }).join('\n');
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (job.status !== 'completed') return NextResponse.json({ error: `任务未完成(${job.status})` }, { status: 400 });

  const screenplay = job.pipelineState.phase4Output;
  if (!screenplay) return NextResponse.json({ error: '剧本数据不存在' }, { status: 404 });
  return NextResponse.json({
    screenplay,
    yaml: serializeToYaml(screenplay),
    analytics: screenplay.analytics,
    metadata: screenplay.metadata,
    chapterTexts: job.chapterTexts,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = jobStore.get(jobId);
  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 });

  const screenplay = job.pipelineState.phase4Output;
  if (!screenplay) return NextResponse.json({ error: '剧本数据不存在' }, { status: 404 });

  try {
    const body = await request.json();
    const updated: Screenplay = JSON.parse(JSON.stringify(screenplay));

    // Full YAML replacement
    if (body.yaml !== undefined) {
      const result = safeParseFromYaml(body.yaml);
      if (!result.success) {
        const details = extractZodIssues(result.error, result.issues);
        return NextResponse.json({ error: 'YAML 校验失败', details }, { status: 400 });
      }
      jobStore.update(jobId, j => ({ ...j, pipelineState: { ...j.pipelineState, phase4Output: result.data } }));
      return NextResponse.json({ success: true, message: '剧本更新成功' });
    }

    // Delete entity by ID
    if (body.deleteCharacterId !== undefined) {
      updated.characters = updated.characters.filter(c => c.characterId !== body.deleteCharacterId);
      updated.metadata.totalCharacters = updated.characters.length;
    } else if (body.deleteLocationId !== undefined) {
      updated.locations = updated.locations.filter(l => l.locationId !== body.deleteLocationId);
      updated.metadata.totalLocations = updated.locations.length;
    } else {
      // Partial entity updates
      if (Array.isArray(body.scenes)) {
        updated.scenes = body.scenes;
        updated.metadata.totalScenes = body.scenes.length;
      }
      if (Array.isArray(body.characters)) {
        updated.characters = body.characters;
        updated.metadata.totalCharacters = body.characters.length;
      }
      if (Array.isArray(body.locations)) {
        updated.locations = body.locations;
        updated.metadata.totalLocations = body.locations.length;
      }
      if (body.scene !== undefined) {
        const idx = updated.scenes.findIndex(s => s.sceneNumber === body.scene.sceneNumber);
        // Auto-derive slugline from location + timeOfDay when slugline is not set
        const loc = updated.locations.find(l => l.locationId === body.scene.locationId);
        const timeLabel = body.scene.timeOfDay;
        const derivedSlugline = body.scene.slugline || (loc ? `${loc.type === 'exterior' ? '外景' : '内景'}. ${loc.name} - ${timeLabel}` : body.scene.slugline);
        const sceneToSave = { ...body.scene, slugline: derivedSlugline };
        if (idx >= 0) updated.scenes[idx] = sceneToSave;
        else updated.scenes.push(sceneToSave);
      }
      if (body.character !== undefined) {
        const idx = updated.characters.findIndex(c => c.characterId === body.character.characterId);
        if (idx >= 0) updated.characters[idx] = body.character;
        else updated.characters.push(body.character);
      }
      if (body.location !== undefined) {
        const idx = updated.locations.findIndex(l => l.locationId === body.location.locationId);
        if (idx >= 0) updated.locations[idx] = body.location;
        else updated.locations.push(body.location);
      }
    }

    // Validate and save
    const yaml = serializeToYaml(updated);
    const result = safeParseFromYaml(yaml);
    if (!result.success) {
      console.error('[PATCH /api/result] YAML validation failed:', result.error, '\nYAML:\n', yaml);
      const details = extractZodIssues(result.error, result.issues);
      return NextResponse.json({ error: '修改后校验失败', details }, { status: 400 });
    }

    jobStore.update(jobId, j => ({ ...j, pipelineState: { ...j.pipelineState, phase4Output: result.data } }));
    return NextResponse.json({ success: true, message: '更新成功' });
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import YAML from 'yaml';
import { ScreenplaySchema } from '@novel/contracts/screenplay';
import { jobStore } from '@/lib/store/job-store';
import { getCurrentUser, authError } from '@/lib/auth';


function normalizeTime(v: unknown): string {
  const valids = new Set(['dawn', 'morning', 'afternoon', 'dusk', 'night', 'late-night', 'unknown']);
  if (valids.has(v as string)) return v as string;
  if (v === true) return 'late-night';
  if (v === false) return 'unknown';
  if (typeof v === 'string' && v.trim()) return 'late-night';
  return 'unknown';
}

function normalize(data: unknown): unknown {
  if (Array.isArray(data)) {
    const normalized = data.map(normalize);
    // Prune scenes with empty content (invalid for screenplay schema)
    return normalized.filter((item: unknown) => {
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (Array.isArray(obj['content']) && obj['content'].length === 0) return false;
      }
      return true;
    });
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'timeOfDay') {
        out[k] = normalizeTime(v);
      } else if (k === 'content' && !Array.isArray(v)) {
        out[k] = [];
      } else if (k === 'sourceChapterRange' && (v === null || v === undefined)) {
        // skip null optional field
      } else {
        out[k] = normalize(v);
      }
    }
    return out;
  }
  return data;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return authError();

    const body = await request.json();

    if (!body.yaml || typeof body.yaml !== 'string') {
      return NextResponse.json({ error: '缺少 yaml 字段' }, { status: 400 });
    }

    let data = YAML.parse(body.yaml);
    data = normalize(data);

    const sp = ScreenplaySchema.safeParse(data);
    if (!sp.success) {
      return NextResponse.json({
        error: 'YAML 格式错误或不符合剧本 schema',
        details: sp.error.issues.map(i => ({ path: i.path, message: i.message })),
      }, { status: 400 });
    }

    // Dry-run: only validate, do not create a job
    if (body.dryRun === true) {
      return NextResponse.json({
        success: true,
        preview: {
          title: sp.data.metadata.title,
          totalScenes: sp.data.metadata.totalScenes,
          totalCharacters: sp.data.metadata.totalCharacters,
          totalLocations: sp.data.metadata.totalLocations,
        },
      });
    }

    // Create a "completed" job directly with the screenplay result
    const jobId = jobStore.create({
      novelText: '',
      chapterTexts: [],
      modelId: 'imported',
      selectedChapters: [],
      temperature: 0,
      userId: user.id,
    });

    jobStore.update(jobId, j => ({
      ...j,
      status: 'completed',
      progress: 100,
      resultId: jobId,
      pipelineState: { phase4Output: sp.data },
    }));

    return NextResponse.json({
      success: true,
      jobId,
      preview: {
        title: sp.data.metadata.title,
        totalScenes: sp.data.metadata.totalScenes,
        totalCharacters: sp.data.metadata.totalCharacters,
        totalLocations: sp.data.metadata.totalLocations,
      },
    });
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
}

/**
 * Writer AI 写作 API
 *
 * POST /api/writer/novels/[id]/ai
 *   body: { action: 'continue'|'expand'|'rewrite'|'polish', chapterId?, content?, instruction? }
 *   - continue: 续写当前章节（content 为前文）
 *   - expand:   扩写选中段落（content）
 *   - rewrite:  按指定风格改写（content + instruction）
 *   - polish:   润色（content）
 *
 * 复用 ModelRouter（LLM Adapter 层），并注入小说标题/简介/人物卡/世界观/章节大纲
 * 作为上下文，保证 AI 写作与作品设定一致。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWriterNovelRepository } from '@/lib/store/sqlite';
import { getCurrentUser, authError } from '@novel/auth';
import { getModelRouter } from '@/lib/llm/adapter/router';
import type { LLMMessage } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ id: string }>;
}

const ACTIONS = ['continue', 'expand', 'rewrite', 'polish'] as const;
type WriterAction = (typeof ACTIONS)[number];

function cleanModelOutput(text: string): string {
  let out = text.trim();
  // 去掉常见的 markdown 代码块包裹（``` 与 ```markdown 等）
  out = out.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  // 去掉首尾多余引号（模型偶发输出包裹式引号）
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith('「') && out.endsWith('」'))) {
    out = out.slice(1, -1).trim();
  }
  return out;
}

function buildContextPrompt(draft: {
  title: string;
  author: string;
  synopsis: string;
  characters: Array<{ name: string; role: string; traits: string; background: string }>;
  worldItems: Array<{ name: string; category: string; description: string }>;
  chapters: Array<{ title: string; volumeId: string | null }>;
}): string {
  const parts: string[] = [];
  parts.push(`小说标题：《${draft.title}》${draft.author ? `（作者：${draft.author}）` : ''}`);
  if (draft.synopsis) parts.push(`简介：${draft.synopsis}`);
  if (draft.characters.length > 0) {
    parts.push('人物设定：');
    for (const c of draft.characters) {
      const bits = [c.name, c.role, c.traits, c.background].filter(Boolean).join('；');
      parts.push(`- ${bits}`);
    }
  }
  if (draft.worldItems.length > 0) {
    parts.push('世界观：');
    for (const w of draft.worldItems) {
      parts.push(`- ${w.name}（${w.category}）：${w.description}`);
    }
  }
  if (draft.chapters.length > 0) {
    parts.push(`现有章节：${draft.chapters.map((c) => c.title).join('、')}`);
  }
  return parts.join('\n');
}

function buildPrompt(action: WriterAction, context: string, content: string, instruction: string): string {
  const rules = [
    '你是资深中文小说作者，请基于作品设定保持人物性格、世界观与文风一致。',
    '只输出小说正文本身，不要输出解释、标题或评论。',
  ].join('\n');

  switch (action) {
    case 'continue':
      return `${rules}\n\n【作品设定】\n${context}\n\n【任务】续写当前章节：根据前文自然延续情节，保持节奏与文风。\n\n【前文】\n${content}\n\n【续写要求】${instruction || '自然延续，情节推进合理，500-1000 字。'}`;
    case 'expand':
      return `${rules}\n\n【作品设定】\n${context}\n\n【任务】扩写以下段落：补充环境、动作、心理等细节，使其更丰满，不改动原有情节与事实。\n\n【原文】\n${content}\n\n【扩写要求】${instruction || '保留原意并扩充细节，扩写后 2-3 倍篇幅。'}`;
    case 'rewrite':
      return `${rules}\n\n【作品设定】\n${context}\n\n【任务】改写以下段落：${instruction || '保持核心情节，提升文学质感'}。\n\n【原文】\n${content}`;
    case 'polish':
      return `${rules}\n\n【作品设定】\n${context}\n\n【任务】润色以下段落：修正语病、优化表达、增强画面感，不改变情节。\n\n【原文】\n${content}`;
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return authError();

  const repo = getWriterNovelRepository();
  const draft = repo.getDraft(id);
  if (!draft) return NextResponse.json({ error: '创作小说不存在' }, { status: 404 });
  if (draft.userId !== user.id) {
    return NextResponse.json({ error: '无权访问该小说' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action as WriterAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action 必须是 ${ACTIONS.join(' / ')}` }, { status: 400 });
  }
  const content = typeof body?.content === 'string' ? body.content : '';
  if (!content.trim()) {
    return NextResponse.json({ error: '缺少 content（待处理的正文）' }, { status: 400 });
  }
  const instruction = typeof body?.instruction === 'string' ? body.instruction : '';
  const modelId = typeof body?.modelId === 'string' ? body.modelId : undefined;

  const context = buildContextPrompt(draft);
  const prompt = buildPrompt(action, context, content, instruction);
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是一位专业的华语小说作者，擅长长篇小说创作与文本打磨。' },
    { role: 'user', content: prompt },
  ];

  try {
    const router = getModelRouter();
    const response = await router.chat(messages, { temperature: 0.8 }, modelId);
    return NextResponse.json({ result: cleanModelOutput(response.content), model: response.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI 生成失败';
    // 模型未配置时给出可读提示
    if (message.includes('No adapter found') || message.includes('API key') || message.includes('401')) {
      return NextResponse.json({ error: 'AI 模型未配置或密钥无效，请检查环境变量后重试' }, { status: 503 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

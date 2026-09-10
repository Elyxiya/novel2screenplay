/**
 * Markdown 导出（FIX-15 第一步）：场景/角色/分集一体的可读剧本稿。
 *
 * 设计：
 * - 与 YAML 序列化同族（放在 serializers 下），但面向"人读/分享"而非"机器交换"；
 * - 分集信息由调用方传入（episodes 为结构类型，不引入 app 侧依赖）；
 * - 输入接受 Partial 剧本（mock/预览场景常见），缺失字段降级为空而非抛错。
 */
import type { Screenplay } from '../screenplay.js';

/** 分集摘要（结构类型：与 app 侧 planEpisodes 输出兼容） */
export interface MarkdownEpisode {
  episodeNumber: number;
  sceneNumbers: number[];
  durationSec: number;
  hookAtEnd: boolean;
}

export interface MarkdownExportOptions {
  /** 分集表（提供时渲染「分集」章节） */
  episodes?: MarkdownEpisode[];
  /** 附原文溯源行（sourceRefs 的章节+摘录） */
  includeSourceRefs?: boolean;
}

/** 宽松输入：预览/测试场景常只有 scenes + characters */
export type ScreenplayLike = Pick<Screenplay, 'scenes'> &
  Partial<Pick<Screenplay, 'characters' | 'locations' | 'metadata' | 'analytics' | 'formatVersion'>>;

/** 宽松块（monologue 为分阶段迁移类型，见 screenplay.ts B-23 注） */
interface LooseBlock {
  type: string;
  line?: string;
  description?: string;
  direction?: string;
  characterId?: string;
  speaker?: string;
  sourceRefs?: Array<{ chapterIndex: number; paragraphIndex: number; excerpt: string }>;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export function serializeToMarkdown(screenplay: ScreenplayLike, opts: MarkdownExportOptions = {}): string {
  const meta: Partial<Screenplay['metadata']> = screenplay.metadata ?? {};
  const characters = screenplay.characters ?? [];
  const nameById = new Map(characters.map((c) => [c.characterId, c.name]));
  const scenes = screenplay.scenes ?? [];

  const lines: string[] = [];
  lines.push(`# 《${meta.title ?? '未命名'}》剧本（Markdown 导出）`);
  lines.push('');
  lines.push(
    `> ${meta.author ? `作者：${meta.author} ｜ ` : ''}${meta.sourceNovel ? `来源：${meta.sourceNovel} ｜ ` : ''}版本：${screenplay.formatVersion ?? meta.version ?? 'novel2screenplay-v1'}`,
  );
  lines.push(`> 规模：${scenes.length} 场 ｜ ${characters.length} 角色 ｜ ${(screenplay.locations ?? []).length} 地点${meta.createdAt ? ` ｜ 生成于 ${meta.createdAt}` : ''}`);
  lines.push('');

  lines.push('## 角色表');
  lines.push('');
  lines.push('| 名字 | 别名 | 定位 | 简介 |');
  lines.push('|---|---|---|---|');
  for (const c of characters) {
    lines.push(
      `| ${c.name} | ${(c.aliases ?? []).join('、') || '—'} | ${c.isMajor ? '主要' : '次要'} | ${(c.description ?? '').slice(0, 40) || '—'} |`,
    );
  }
  if (characters.length === 0) lines.push('| （无角色数据） | — | — | — |');
  lines.push('');

  if (opts.episodes && opts.episodes.length > 0) {
    lines.push('## 分集');
    lines.push('');
    lines.push('| 集 | 场景 | 时长 | 集末钩子 |');
    lines.push('|---|---|---|---|');
    for (const ep of opts.episodes) {
      lines.push(`| ${ep.episodeNumber} | ${ep.sceneNumbers.map((n) => `#${n}`).join('、')} | ${fmtDuration(ep.durationSec)} | ${ep.hookAtEnd ? '✅' : '—'} |`);
    }
    lines.push('');
  }

  lines.push('## 场景');
  lines.push('');
  for (const scene of scenes) {
    lines.push(`### 场 ${scene.sceneNumber} · ${scene.slugline}（${scene.timeOfDay ?? 'unknown'}）`);
    const present = (scene.characterIds ?? []).map((id) => nameById.get(id) ?? id).join('、');
    if (present) lines.push(`- 在场：${present}`);
    if (scene.summary) lines.push(`- 摘要：${scene.summary}`);
    lines.push('');
    for (const block of (scene.content ?? []) as unknown as LooseBlock[]) {
      if (block.type === 'dialogue') {
        const who = nameById.get(block.characterId ?? '') ?? block.characterId ?? '?';
        lines.push(`- 【${who}】${block.direction ? `（${block.direction}）` : ''}${block.line ?? ''}`);
      } else if (block.type === 'monologue') {
        lines.push(`- 【${block.speaker ?? 'NV'}·旁白】${block.direction ? `（${block.direction}）` : ''}${block.line ?? ''}`);
      } else {
        lines.push(`- 〔动作〕${block.description ?? ''}`);
      }
      if (opts.includeSourceRefs && block.sourceRefs && block.sourceRefs.length > 0) {
        const ref = block.sourceRefs[0];
        lines.push(`  - ↳ 原文：第 ${ref.chapterIndex + 1} 章 · ${(ref.excerpt ?? '').slice(0, 40)}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

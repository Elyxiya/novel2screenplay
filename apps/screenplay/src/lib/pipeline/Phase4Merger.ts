import type { Phase1Output, RawCharacter, RawLocation } from './Phase1Analyzer';
import type { Phase2Output } from './Phase2Segmenter';
import type { Phase3Output } from './Phase3SceneConverter';
import type { Screenplay } from '@novel/contracts/screenplay';
import { autoFixScreenplay } from '@novel/contracts/validator';

/**
 * Simple Levenshtein distance calculator.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
      }
    }
  }
  return dp[m][n];
}

/**
 * Check if two character names are similar enough to merge.
 */
function isSimilarName(a: string, b: string): boolean {
  if (a === b) return true;
  // Normalize: remove non-Chinese characters
  const normA = a.replace(/[^一-鿿\w]/g, '');
  const normB = b.replace(/[^一-鿿\w]/g, '');
  if (normA === normB) return true;

  // Check inclusion: longer name contains shorter name AND shorter is ≥2 chars
  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length > normB.length ? normA : normB;
  if (shorter.length >= 2 && longer.includes(shorter)) return true;

  // Levenshtein distance, threshold 0.3
  const dist = levenshtein(normA, normB);
  return dist / Math.max(normA.length, normB.length, 1) < 0.3;
}

/**
 * Phase 4: Merge all phase outputs into a validated Screenplay.
 * Performs character/location dedup, ID resolution, and analytics.
 */
export class Phase4Merger {
  async merge(
    metadata: { title: string; author: string; sourceNovel: string },
    phase1Output: Phase1Output,
    phase2Output: Phase2Output,
    phase3Outputs: Phase3Output[],
  ): Promise<{ screenplay: Screenplay; fixes: string[] }> {
    // 1. Deduplicate characters
    const { characters, charFixes } = this.deduplicateCharacters(phase1Output.characters);

    // 2. Deduplicate locations
    const { locations, locFixes } = this.deduplicateLocations(phase1Output.locations);

    // 3. Build ID maps
    const charNameToId = new Map<string, string>();
    for (const c of characters) {
      charNameToId.set(c.name, c.characterId);
      c.aliases.forEach((a) => charNameToId.set(a, c.characterId));
    }

    const locNameToId = new Map<string, string>();
    for (const l of locations) {
      locNameToId.set(l.name, l.locationId);
    }

    // 4. Resolve character/location IDs in scenes
    const scenes = phase3Outputs.map((scene, i) => {
      const phase2Scene = phase2Output.scenes[i];

      // Try to find a location match
      let locationId = scene.locationId;
      if (!locations.find((l) => l.locationId === locationId)) {
        // Try matching by name from slugline
        const slugLoc = scene.slugline.split(' - ')[0] || '';
        for (const l of locations) {
          if (slugLoc.includes(l.name) || l.name.includes(slugLoc)) {
            locationId = l.locationId;
            break;
          }
        }
      }

      return {
        sceneNumber: scene.sceneNumber,
        slugline: scene.slugline,
        timeOfDay: scene.timeOfDay as SceneTimeOfDay,
        locationId,
        characterIds: scene.characterIds.map((id) => charNameToId.get(id) || id),
        content: scene.content.map((block) => ({
          ...block,
          characterId: block.characterId
            ? charNameToId.get(block.characterId) || block.characterId
            : undefined,
        })),
        summary: scene.summary,
        sourceChapterRange: [
          phase2Scene?.chapterIndex ?? 0,
          phase2Scene?.chapterIndex ?? 0,
        ] as [number, number],
        confidence: scene.confidence,
      };
    });

    // 5. Compute analytics
    const analytics = this.computeAnalytics(scenes);

    // 6. Build Screenplay object
    const screenplay: Screenplay = {
      formatVersion: 'novel2screenplay-v1',
      metadata: {
        title: metadata.title,
        author: metadata.author,
        sourceNovel: metadata.sourceNovel,
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        totalScenes: scenes.length,
        totalCharacters: characters.length,
        totalLocations: locations.length,
      },
      characters,
      locations,
      scenes: scenes as Screenplay['scenes'],
      analytics,
    };

    // 7. Auto-fix cross-reference issues
    const { fixed, fixes: autoFixes } = autoFixScreenplay(screenplay);

    return {
      screenplay: fixed,
      fixes: [...charFixes, ...locFixes, ...autoFixes],
    };
  }

  private deduplicateCharacters(rawChars: RawCharacter[]): {
    characters: Screenplay['characters'];
    charFixes: string[];
  } {
    const charFixes: string[] = [];
    const merged: Screenplay['characters'] = [];

    // Pre-build alias map
    const aliasMap = new Map<string, string>();
    for (const c of rawChars) {
      for (const alias of c.aliases) {
        aliasMap.set(alias, c.name);
      }
    }

    for (const c of rawChars) {
      const existing = merged.find(
        (m) =>
          isSimilarName(m.name, c.name) ||
          c.aliases.some((a) => {
            const mapped = aliasMap.get(a);
            return mapped === m.name || isSimilarName(a, m.name);
          }),
      );

      if (existing) {
        // Merge aliases
        const allAliases = new Set([...existing.aliases, ...c.aliases, c.name]);
        existing.aliases = Array.from(allAliases);
        if (!existing.description && c.description) {
          existing.description = c.description;
        }
        charFixes.push(`合并角色: ${c.name} → ${existing.name}`);
      } else {
        const id = `char_${String(merged.length + 1).padStart(2, '0')}`;
        merged.push({
          characterId: id,
          name: c.name,
          aliases: c.aliases || [],
          personalityTags: c.personalityTags || [],
          description: c.description || '',
          isMajor: c.isMajor ?? true,
        });
      }
    }

    return { characters: merged, charFixes };
  }

  private deduplicateLocations(rawLocs: RawLocation[]): {
    locations: Screenplay['locations'];
    locFixes: string[];
  } {
    const locFixes: string[] = [];
    const merged: Screenplay['locations'] = [];

    for (const l of rawLocs) {
      const existing = merged.find(
        (m) =>
          isSimilarName(m.name, l.name) || m.name.includes(l.name) || l.name.includes(m.name),
      );

      if (existing) {
        if (!existing.description && l.description) {
          existing.description = l.description;
        }
        locFixes.push(`合并地点: ${l.name} → ${existing.name}`);
      } else {
        const id = `loc_${String(merged.length + 1).padStart(2, '0')}`;
        merged.push({
          locationId: id,
          name: l.name,
          type: l.type || 'interior',
          description: l.description || '',
        });
      }
    }

    return { locations: merged, locFixes };
  }

  private computeAnalytics(
    scenes: Array<{ content: Phase3Output['content']; sceneNumber: number }>,
  ): Screenplay['analytics'] {
    let totalWords = 0;
    let dialogueWords = 0;
    let actionWords = 0;
    const sceneLengths: number[] = [];

    for (const scene of scenes) {
      let sceneWords = 0;
      for (const block of scene.content) {
        const text = block.type === 'dialogue' ? (block.line ?? '') : (block.description ?? '');
        const wordCount = text.length;
        totalWords += wordCount;
        sceneWords += wordCount;

        if (block.type === 'dialogue') {
          dialogueWords += wordCount;
        } else {
          actionWords += wordCount;
        }
      }
      sceneLengths.push(sceneWords);
    }

    const total = totalWords || 1; // Prevent division by zero
    const sortedLengths = [...sceneLengths].sort((a, b) => a - b);

    return {
      totalWords,
      dialoguePercentage: Math.round((dialogueWords / total) * 100),
      actionPercentage: Math.round((actionWords / total) * 100),
      avgSceneLength: sceneLengths.length > 0
        ? Math.round(sceneLengths.reduce((a, b) => a + b, 0) / sceneLengths.length)
        : 0,
      longestScene: sortedLengths[sortedLengths.length - 1] || 0,
      shortestScene: sortedLengths[0] || 0,
    };
  }
}

type SceneTimeOfDay =
  | 'dawn' | 'morning' | 'afternoon' | 'dusk' | 'night' | 'late-night' | 'unknown';

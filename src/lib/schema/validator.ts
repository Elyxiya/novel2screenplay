import { ScreenplaySchema, type Screenplay } from './screenplay.schema';

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: ValidationWarning[];
}

/**
 * Validate a Screenplay object for structural correctness and cross-reference integrity.
 */
export function validateScreenplay(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  // 1. Zod structural validation
  const parsed = ScreenplaySchema.safeParse(data);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.errors.map(
        (e) => `${e.path.join('.')}: ${e.message}`,
      ),
      warnings: [],
    };
  }

  const screenplay = parsed.data;

  // 2. Cross-reference: every scene.locationId must exist in locations[]
  const locationIds = new Set(screenplay.locations.map((l) => l.locationId));
  const characterIds = new Set(screenplay.characters.map((c) => c.characterId));

  for (const scene of screenplay.scenes) {
    if (!locationIds.has(scene.locationId)) {
      errors.push(
        `场景 #${scene.sceneNumber} 引用了不存在的 locationId: ${scene.locationId}`,
      );
    }

    for (const charId of scene.characterIds) {
      if (!characterIds.has(charId)) {
        warnings.push({
          path: `scenes[${scene.sceneNumber}].characterIds`,
          message: `场景 #${scene.sceneNumber} 引用未知角色 ${charId}，将在角色列表中自动创建占位记录`,
        });
      }
    }

    for (const block of scene.content) {
      if (block.type === 'dialogue') {
        if (!characterIds.has(block.characterId)) {
          warnings.push({
            path: `scenes[${scene.sceneNumber}].content`,
            message: `对白引用了未知角色 ${block.characterId}，将在角色列表中自动创建占位记录`,
          });
        }
      }
    }
  }

  // 3. Scene numbers must be sequential from 1
  const sceneNumbers = screenplay.scenes.map((s) => s.sceneNumber).sort((a, b) => a - b);
  for (let i = 0; i < sceneNumbers.length; i++) {
    if (sceneNumbers[i] !== i + 1) {
      warnings.push({
        path: 'scenes[*].sceneNumber',
        message: `场景编号不连续，期望 ${i + 1}，实际为 ${sceneNumbers[i]}`,
      });
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Auto-fix common cross-reference issues by creating stub entries.
 */
export function autoFixScreenplay(screenplay: Screenplay): {
  fixed: Screenplay;
  fixes: string[];
} {
  const fixes: string[] = [];
  const fixed = JSON.parse(JSON.stringify(screenplay)) as Screenplay;

  const locationIds = new Set(fixed.locations.map((l) => l.locationId));
  const characterIds = new Set(fixed.characters.map((c) => c.characterId));
  let nextCharId = fixed.characters.length + 1;
  let nextLocId = fixed.locations.length + 1;

  for (const scene of fixed.scenes) {
    // Fix missing location
    if (!locationIds.has(scene.locationId)) {
      const newLocId = `loc_${String(nextLocId).padStart(2, '0')}`;
      fixed.locations.push({
        locationId: newLocId,
        name: `未知地点 (${scene.locationId})`,
        type: 'interior',
        description: '由校验器自动创建的占位地点',
      });
      locationIds.add(newLocId);
      fixes.push(`场景 #${scene.sceneNumber}: 创建缺失地点 ${newLocId}`);
      nextLocId++;
    }

    // Fix missing characters in characterIds
    const updatedCharIds: string[] = [];
    for (const charId of scene.characterIds) {
      if (!characterIds.has(charId)) {
        const newCharId = `char_${String(nextCharId).padStart(2, '0')}`;
        fixed.characters.push({
          characterId: newCharId,
          name: `未知角色 (${charId})`,
          aliases: [],
          personalityTags: [],
          description: '由校验器自动创建的占位角色',
          isMajor: false,
        });
        characterIds.add(newCharId);
        fixes.push(`场景 #${scene.sceneNumber}: 创建缺失角色 ${newCharId}`);
        updatedCharIds.push(newCharId);
        nextCharId++;
      } else {
        updatedCharIds.push(charId);
      }
    }
    scene.characterIds = updatedCharIds;

    // Fix missing characters in dialogue blocks
    for (const block of scene.content) {
      if (block.type === 'dialogue' && !characterIds.has(block.characterId)) {
        const newCharId = `char_${String(nextCharId).padStart(2, '0')}`;
        fixed.characters.push({
          characterId: newCharId,
          name: `未知角色 (${block.characterId})`,
          aliases: [],
          personalityTags: [],
          description: '由校验器自动创建的占位角色',
          isMajor: false,
        });
        characterIds.add(newCharId);
        block.characterId = newCharId;
        fixes.push(`场景 #${scene.sceneNumber}: 对白中创建缺失角色 ${newCharId}`);
        nextCharId++;
      }
    }
  }

  // Update metadata counts
  fixed.metadata.totalCharacters = fixed.characters.length;
  fixed.metadata.totalLocations = fixed.locations.length;

  return { fixed, fixes };
}

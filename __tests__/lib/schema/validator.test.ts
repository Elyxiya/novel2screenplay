import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { serializeToYaml, parseFromYaml, safeParseFromYaml } from '../../../src/lib/schema/yaml-serializer';
import { validateScreenplay, autoFixScreenplay } from '../../../src/lib/schema/validator';
import type { Screenplay } from '../../../src/lib/schema/screenplay.schema';

function loadFixture(): string {
  return readFileSync(join(__dirname, '../../fixtures/sample-screenplay.yaml'), 'utf-8');
}

describe('YAML Serializer', () => {
  it('should parse fixture YAML', () => {
    const yaml = loadFixture();
    const result = parseFromYaml(yaml);
    expect(result.metadata.title).toBe('测试剧本');
    expect(result.characters).toHaveLength(3);
    expect(result.locations).toHaveLength(2);
    expect(result.scenes).toHaveLength(2);
  });

  it('should serialize and parse back to same structure', () => {
    const yaml = loadFixture();
    const parsed = parseFromYaml(yaml);
    const serialized = serializeToYaml(parsed);
    const reparsed = parseFromYaml(serialized);
    expect(reparsed.metadata.title).toBe(parsed.metadata.title);
    expect(reparsed.characters).toHaveLength(parsed.characters.length);
    expect(reparsed.scenes[0].content).toHaveLength(parsed.scenes[0].content.length);
  });

  it('should return error for invalid YAML', () => {
    const result = safeParseFromYaml('invalid: [unclosed');
    expect(result.success).toBe(false);
  });
});

describe('Validator', () => {
  it('should validate a correct screenplay', () => {
    const yaml = loadFixture();
    const screenplay = parseFromYaml(yaml);
    const result = validateScreenplay(screenplay);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect missing character cross-references', () => {
    const yaml = loadFixture();
    const screenplay = parseFromYaml(yaml);
    screenplay.scenes[0].characterIds.push('char_999');
    const result = validateScreenplay(screenplay);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.message.includes('char_999'))).toBe(true);
  });

  it('should auto-fix missing character references', () => {
    const yaml = loadFixture();
    const screenplay = parseFromYaml(yaml);
    const origCharCount = screenplay.characters.length;

    screenplay.scenes[0].characterIds.push('char_999');
    screenplay.scenes[0].content.push({
      type: 'dialogue',
      characterId: 'char_888',
      line: '你是谁？',
      sourceRefs: [],
    });

    const { fixed, fixes } = autoFixScreenplay(screenplay);
    expect(fixed.characters.length).toBeGreaterThan(origCharCount);
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.includes('char_04') || f.includes('char_05'))).toBe(true);
  });

  it('should detect non-sequential scene numbers', () => {
    const yaml = loadFixture();
    const screenplay = parseFromYaml(yaml);
    // The validator will detect non-sequential numbering
    screenplay.scenes[0].sceneNumber = 5;
    const result = validateScreenplay(screenplay);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

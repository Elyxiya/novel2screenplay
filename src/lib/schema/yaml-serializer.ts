import YAML from 'yaml';
import { ScreenplaySchema, type Screenplay } from './screenplay.schema';

export function serializeToYaml(screenplay: Screenplay): string {
  return YAML.stringify(screenplay, { indent: 2, lineWidth: 120, sortMapEntries: false });
}

/**
 * Parse a YAML string into a Screenplay object with validation.
 */
export function parseFromYaml(yamlStr: string): Screenplay {
  const parsed = YAML.parse(yamlStr);
  return ScreenplaySchema.parse(parsed);
}

/**
 * Parse without throwing — returns validation result.
 */
export function safeParseFromYaml(
  yamlStr: string,
): { success: true; data: Screenplay } | { success: false; error: string } {
  try {
    const parsed = YAML.parse(yamlStr);
    const result = ScreenplaySchema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error.message };
  } catch (e) {
    return { success: false, error: `YAML parse error: ${(e as Error).message}` };
  }
}

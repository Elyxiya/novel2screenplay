import YAML from 'yaml';
import { z } from 'zod';
import { ScreenplaySchema, type Screenplay } from './screenplay.schema';

/**
 * Parse a YAML string into a Screenplay object with validation.
 */
export function parseFromYaml(yamlStr: string): Screenplay {
  const parsed = YAML.parse(yamlStr);
  return ScreenplaySchema.parse(parsed);
}

type ZodIssue = { path: (string | number)[]; message: string };

/**
 * Parse without throwing — returns validation result.
 */
export function safeParseFromYaml(
  yamlStr: string,
): { success: true; data: Screenplay } | { success: false; error: string; issues: ZodIssue[] } {
  try {
    const parsed = YAML.parse(yamlStr);
    const result = ScreenplaySchema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    const issues: ZodIssue[] = result.error.issues.map(iss => ({
      path: iss.path,
      message: iss.message,
    }));
    return { success: false, error: result.error.message, issues };
  } catch (e) {
    return { success: false, error: `YAML parse error: ${(e as Error).message}`, issues: [] };
  }
}

/**
 * Serialize a validated Screenplay object to a YAML string.
 * blockScalarAsString ensures long strings use readable block scalar style.
 */
export function serializeToYaml(screenplay: Screenplay): string {
  return YAML.stringify(screenplay, {
    indent: 2,
    lineWidth: 0,
    blockScalarAsString: true,
    nullStr: '',
    sortMapEntries: false,
  });
}

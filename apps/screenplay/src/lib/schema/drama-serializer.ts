import YAML from 'yaml';
import { DramaSchema, type Drama } from './drama.schema';

/**
 * Parse a YAML string into a Drama object with validation.
 */
export function parseDramaFromYaml(yamlStr: string): Drama {
  const parsed = YAML.parse(yamlStr);
  return DramaSchema.parse(parsed);
}

type ZodIssue = { path: (string | number)[]; message: string };

/**
 * Parse without throwing — returns validation result.
 */
export function safeParseDramaFromYaml(
  yamlStr: string,
): { success: true; data: Drama } | { success: false; error: string; issues: ZodIssue[] } {
  try {
    const parsed = YAML.parse(yamlStr);
    const result = DramaSchema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    const issues: ZodIssue[] = result.error.issues.map(iss => ({
      path: iss.path.map(p => String(p)),
      message: iss.message,
    }));
    return { success: false, error: result.error.message, issues };
  } catch (e) {
    return { success: false, error: `YAML parse error: ${(e as Error).message}`, issues: [] };
  }
}

/**
 * Serialize a validated Drama object to a YAML string.
 */
export function serializeDramaToYaml(drama: Drama): string {
  return YAML.stringify(drama, {
    indent: 2,
    lineWidth: 0,
    nullStr: '',
  });
}

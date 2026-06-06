import YAML from 'yaml';
import { ScreenplaySchema, type Screenplay } from './screenplay.schema';

/**
 * Serialize a validated Screenplay object to a YAML string.
 * Uses block-scalar style for long descriptions and flow style for short arrays.
 */
export function serializeToYaml(screenplay: Screenplay): string {
  return YAML.stringify(screenplay, {
    indent: 2,
    lineWidth: 120,
    nullStr: '',
    sortMapEntries: false,
    // Custom type for block-scalar descriptions
    customTags: [
      {
        tag: '!block',
        identify: () => false,
        createNode: (str: string) => {
          if (typeof str !== 'string') return str;
          // Use block scalar (|) for multi-line descriptions
          if (str.length > 60 || str.includes('\n')) {
            return { type: 'BLOCK_LITERAL', str: str };
          }
          return str;
        },
      },
    ],
  });
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

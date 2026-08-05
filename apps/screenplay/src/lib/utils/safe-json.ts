/**
 * Safe JSON parsing utilities with multiple fallback strategies.
 */

/**
 * Attempt to extract and parse JSON from LLM response text.
 * Tries multiple strategies in order of sophistication.
 */
export function safeJsonParse(text: string): unknown {
  // Strategy 1: Direct parse (fastest)
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }

  // Strategy 2: Strip markdown code fences
  const stripped = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch { /* fall through */ }

  // Strategy 3: Find first JSON object or array using bracket matching
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  const start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);

  if (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end !== -1) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch { /* fall through */ }
    }
  }

  // Strategy 4: Strip trailing commas and common garbage
  const cleaned = stripped
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
    .replace(/[\x00-\x1F]/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { _parseError: true, originalText: text };
  }
}

/**
 * Check if a parsed result looks like a truncated response.
 * Returns true if content array is suspiciously small or missing.
 */
export function looksTruncated(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const obj = result as Record<string, unknown>;
  // Only flag as truncated if the content array exists and has a single
  // extremely long block (possible mid-output truncation). A missing content
  // field or empty content is a valid LLM response (nothing to convert),
  // not necessarily a truncation.
  const content = obj.content;
  if (Array.isArray(content) && content.length === 1) {
    const block = content[0] as Record<string, unknown>;
    const desc = typeof block?.description === 'string' ? block.description : '';
    const line = typeof block?.line === 'string' ? block.line : '';
    if (desc.length + line.length > 3000) return true;
  }
  return false;
}

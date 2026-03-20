import type { VisualizationSpec } from 'vega-embed';

interface ExtractedContent {
  text: string;
  vegaSpecs: VisualizationSpec[];
}

export type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'chart'; spec: VisualizationSpec };

/**
 * Extracts Vega-Lite spec from UC function tool output format.
 * Format: {"columns":["output"],"rows":[["{...vega spec...}"]]}
 */
export function extractVegaFromToolOutput(
  output: unknown,
): VisualizationSpec | null {
  try {
    // Check if output matches the expected structure
    if (
      typeof output === 'object' &&
      output !== null &&
      'rows' in output &&
      Array.isArray((output as any).rows)
    ) {
      const rows = (output as any).rows;
      if (rows.length > 0 && Array.isArray(rows[0]) && rows[0].length > 0) {
        const specString = rows[0][0];
        if (typeof specString === 'string') {
          const spec = JSON.parse(specString);
          if (isVegaLiteSpec(spec)) {
            return spec;
          }
        }
      }
    }

    // Also try parsing if output is a string directly
    if (typeof output === 'string') {
      const spec = JSON.parse(output);
      if (isVegaLiteSpec(spec)) {
        return spec;
      }
    }
  } catch (_err) {
    // Not a valid Vega spec, ignore
  }

  return null;
}

/**
 * Extracts ALL Vega-Lite specifications from text content.
 * Supports multiple formats:
 * 1. vega-lite code blocks: ```vega-lite\n{...}\n```
 * 2. JSON code blocks: ```json\n{...}\n```
 * 3. Raw JSON objects that look like Vega-Lite specs
 */
export function extractVegaSpec(content: string): ExtractedContent {
  const vegaSpecs: VisualizationSpec[] = [];
  let remainingText = content;

  // Extract ALL vega-lite blocks (use matchAll for multiple)
  const vegaBlockMatches = content.matchAll(/```vega-lite\s*([\s\S]*?)\s*```/g);
  for (const match of vegaBlockMatches) {
    try {
      const spec = JSON.parse(match[1]);
      if (isVegaLiteSpec(spec)) {
        vegaSpecs.push(spec);
        remainingText = remainingText.replace(match[0], '');
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // Extract ALL json blocks that are vega specs
  const jsonBlockMatches = content.matchAll(/```json\s*([\s\S]*?)\s*```/g);
  for (const match of jsonBlockMatches) {
    try {
      const spec = JSON.parse(match[1]);
      if (isVegaLiteSpec(spec)) {
        vegaSpecs.push(spec);
        remainingText = remainingText.replace(match[0], '');
      }
    } catch {
      // Not valid JSON, skip
    }
  }

  // If we already found specs in code blocks, return them
  if (vegaSpecs.length > 0) {
    return { text: remainingText.trim(), vegaSpecs };
  }

  // Fallback: Try to find any JSON objects that look like Vega-Lite
  // Find all { positions and try parsing from each
  const positions: number[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      positions.push(i);
    }
  }

  // Track which ranges we've already extracted to avoid duplicates
  const extractedRanges: Array<{ start: number; end: number }> = [];

  for (const pos of positions) {
    // Skip if this position is within an already extracted range
    if (extractedRanges.some((r) => pos >= r.start && pos < r.end)) {
      continue;
    }

    try {
      // Try to find the matching closing brace
      let depth = 0;
      let endPos = pos;
      let inString = false;
      let escapeNext = false;

      for (let i = pos; i < content.length; i++) {
        const char = content[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') depth++;
          if (char === '}') {
            depth--;
            if (depth === 0) {
              endPos = i + 1;
              break;
            }
          }
        }
      }

      if (endPos > pos) {
        const possibleJson = content.slice(pos, endPos);
        const spec = JSON.parse(possibleJson);
        if (isVegaLiteSpec(spec)) {
          vegaSpecs.push(spec);
          extractedRanges.push({ start: pos, end: endPos });
          remainingText = remainingText.replace(possibleJson, '');
        }
      }
    } catch {
      // Not valid JSON from this position, continue
    }
  }

  return { text: remainingText.trim(), vegaSpecs };
}

/**
 * Extracts Vega-Lite specs inline, returning interleaved text and chart segments.
 * Charts appear where they were in the original text, not at the bottom.
 */
export function extractVegaSpecInline(content: string): ContentSegment[] {
  // Collect all spec matches with their positions
  const matches: Array<{ start: number; end: number; spec: VisualizationSpec }> = [];

  // Find vega-lite code blocks
  for (const match of content.matchAll(/```vega-lite\s*([\s\S]*?)\s*```/g)) {
    try {
      const spec = JSON.parse(match[1]);
      if (isVegaLiteSpec(spec)) {
        matches.push({ start: match.index!, end: match.index! + match[0].length, spec });
      }
    } catch { /* skip */ }
  }

  // Find json code blocks that are vega specs
  for (const match of content.matchAll(/```json\s*([\s\S]*?)\s*```/g)) {
    try {
      const spec = JSON.parse(match[1]);
      if (isVegaLiteSpec(spec) && !matches.some(m => m.start === match.index)) {
        matches.push({ start: match.index!, end: match.index! + match[0].length, spec });
      }
    } catch { /* skip */ }
  }

  // If no code block matches, try raw JSON (same logic as extractVegaSpec)
  if (matches.length === 0) {
    for (let i = 0; i < content.length; i++) {
      if (content[i] !== '{') continue;
      if (matches.some(m => i >= m.start && i < m.end)) continue;

      try {
        let depth = 0;
        let endPos = i;
        let inString = false;
        let escapeNext = false;

        for (let j = i; j < content.length; j++) {
          const char = content[j];
          if (escapeNext) { escapeNext = false; continue; }
          if (char === '\\') { escapeNext = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (!inString) {
            if (char === '{') depth++;
            if (char === '}') { depth--; if (depth === 0) { endPos = j + 1; break; } }
          }
        }

        if (endPos > i) {
          const spec = JSON.parse(content.slice(i, endPos));
          if (isVegaLiteSpec(spec)) {
            matches.push({ start: i, end: endPos, spec });
          }
        }
      } catch { /* skip */ }
    }
  }

  if (matches.length === 0) {
    return [{ type: 'text', content }];
  }

  // Sort by position
  matches.sort((a, b) => a.start - b.start);

  // Build interleaved segments
  const segments: ContentSegment[] = [];
  let cursor = 0;

  for (const match of matches) {
    const textBefore = content.slice(cursor, match.start).trim();
    if (textBefore) {
      segments.push({ type: 'text', content: textBefore });
    }
    segments.push({ type: 'chart', spec: match.spec });
    cursor = match.end;
  }

  const textAfter = content.slice(cursor).trim();
  if (textAfter) {
    segments.push({ type: 'text', content: textAfter });
  }

  return segments;
}

/**
 * Checks if an object is a valid Vega-Lite specification.
 * Looks for key indicators like $schema, mark, layer, or encoding.
 */
function isVegaLiteSpec(obj: unknown): obj is VisualizationSpec {
  if (typeof obj !== 'object' || obj === null) return false;

  const spec = obj as Record<string, unknown>;

  // Check for Vega-Lite schema
  if (
    typeof spec.$schema === 'string' &&
    spec.$schema.includes('vega-lite')
  ) {
    return true;
  }

  // Check for key Vega-Lite properties
  const hasMarkOrLayer = 'mark' in spec || 'layer' in spec || 'spec' in spec;
  const hasDataOrEncoding = 'data' in spec || 'encoding' in spec;

  return hasMarkOrLayer || hasDataOrEncoding;
}

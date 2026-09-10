/**
 * Parse the NYS `violations` text column into structured entries.
 *
 * The column is either "No violations found." or a run of entries like:
 *   "Item  5B-  Critical Violation [RED] Potentially hazardous foods ...; Item  8A-   Food not protected ...;"
 */
export interface Violation {
  code: string | null;
  critical: boolean;
  description: string;
}

const ENTRY = /^Item\s+([0-9]{1,2}[A-Z]{0,2})\s*-\s*(.*)$/s;
const CRITICAL = /^Critical Violation\s*(\[[A-Z]+\])?\s*/i;

export function parseViolations(raw: string | null | undefined): Violation[] {
  const text = (raw ?? "").trim();
  if (!text || /^no violations/i.test(text)) return [];

  return text
    .split(/;\s*(?=Item\s)/)
    .map((chunk) => chunk.trim().replace(/;+$/, "").trim())
    .filter(Boolean)
    .map((chunk): Violation => {
      const m = ENTRY.exec(chunk);
      if (!m) return { code: null, critical: false, description: collapse(chunk) };
      let rest = m[2] ?? "";
      const critical = CRITICAL.test(rest);
      if (critical) rest = rest.replace(CRITICAL, "");
      return { code: m[1] ?? null, critical, description: collapse(rest) };
    })
    .filter((v) => v.description.length > 0);
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

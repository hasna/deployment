export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 200;
export const DEFAULT_LOG_LINES = 120;
export const DEFAULT_TEXT_WIDTH = 80;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  cursor: number;
  nextCursor: number | null;
}

export function parsePositiveInt(
  value: string | number | undefined,
  fallback: number,
  max: number = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function parseCursor(value: string | number | undefined): number {
  if (value === undefined || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

export function pageItems<T>(
  items: readonly T[],
  opts: {
    limit?: string | number;
    cursor?: string | number;
    defaultLimit?: number;
    maxLimit?: number;
  } = {}
): Page<T> {
  const limit = parsePositiveInt(opts.limit, opts.defaultLimit ?? DEFAULT_LIST_LIMIT, opts.maxLimit ?? MAX_LIST_LIMIT);
  const cursor = parseCursor(opts.cursor);
  const page = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < items.length ? cursor + page.length : null;
  return { items: page, total: items.length, limit, cursor, nextCursor };
}

export function truncateText(value: unknown, maxLength: number = DEFAULT_TEXT_WIDTH): string {
  const text = value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return ".".repeat(maxLength);
  return text.slice(0, maxLength - 3).trimEnd() + "...";
}

export function summarizeObject(value: Record<string, unknown> | undefined | null): string {
  if (!value || Object.keys(value).length === 0) return "{}";
  const keys = Object.keys(value);
  return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", ..." : ""}}`;
}

export function tailLines(text: string, lines: number = DEFAULT_LOG_LINES): { text: string; omitted: number } {
  const allLines = text.split(/\r?\n/);
  const safeLines = parsePositiveInt(lines, DEFAULT_LOG_LINES, 10_000);
  if (allLines.length <= safeLines) return { text, omitted: 0 };
  return {
    text: allLines.slice(-safeLines).join("\n"),
    omitted: allLines.length - safeLines,
  };
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

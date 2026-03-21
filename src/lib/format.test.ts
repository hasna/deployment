import { describe, it, expect } from "bun:test";
import { timeAgo, shortId } from "./format.js";

describe("format", () => {
  describe("timeAgo", () => {
    it('returns "just now" for a date within the last 10 seconds', () => {
      const now = new Date().toISOString();
      expect(timeAgo(now)).toBe("just now");
    });

    it('returns "just now" for a future date', () => {
      const future = new Date(Date.now() + 60_000).toISOString();
      expect(timeAgo(future)).toBe("just now");
    });

    it('returns "Xs ago" for seconds between 10 and 59', () => {
      const date = new Date(Date.now() - 30_000).toISOString();
      const result = timeAgo(date);
      expect(result).toMatch(/^\d+s ago$/);
    });

    it('returns "Xm ago" for minutes', () => {
      const date = new Date(Date.now() - 5 * 60_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("5m ago");
    });

    it('returns "Xh ago" for hours', () => {
      const date = new Date(Date.now() - 3 * 3_600_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("3h ago");
    });

    it('returns "Xd ago" for days', () => {
      const date = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("2d ago");
    });

    it('returns "Xw ago" for weeks', () => {
      const date = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("2w ago");
    });

    it('returns "Xmo ago" for months', () => {
      const date = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("2mo ago");
    });

    it('returns "Xy ago" for years', () => {
      const date = new Date(Date.now() - 400 * 86_400_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("1y ago");
    });

    it("returns the original string for invalid dates", () => {
      expect(timeAgo("not-a-date")).toBe("not-a-date");
    });

    it("handles edge case at exactly 60 seconds", () => {
      const date = new Date(Date.now() - 60_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("1m ago");
    });

    it("handles edge case at exactly 60 minutes", () => {
      const date = new Date(Date.now() - 60 * 60_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("1h ago");
    });

    it("handles edge case at exactly 24 hours", () => {
      const date = new Date(Date.now() - 24 * 3_600_000).toISOString();
      const result = timeAgo(date);
      expect(result).toBe("1d ago");
    });
  });

  describe("shortId", () => {
    it("returns the first 8 characters of a string", () => {
      const id = "abcdefgh-1234-5678-9012-345678901234";
      expect(shortId(id)).toBe("abcdefgh");
    });

    it("returns 8 characters for a UUID", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = shortId(uuid);
      expect(result.length).toBe(8);
      expect(result).toBe("550e8400");
    });

    it("returns the full string if shorter than 8 characters", () => {
      expect(shortId("abc")).toBe("abc");
    });

    it("returns exactly 8 characters for a long string", () => {
      const result = shortId("a".repeat(100));
      expect(result.length).toBe(8);
    });

    it("returns empty string for empty input", () => {
      expect(shortId("")).toBe("");
    });
  });
});

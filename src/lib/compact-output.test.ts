import { describe, expect, it } from "bun:test";
import { pageItems, summarizeObject, tailLines, truncateText } from "./compact-output.js";

describe("compact-output", () => {
  it("truncates long text with an ellipsis marker", () => {
    expect(truncateText("alpha beta gamma", 11)).toBe("alpha be...");
    expect(truncateText("short", 20)).toBe("short");
  });

  it("pages lists with a next cursor", () => {
    const page = pageItems([1, 2, 3, 4, 5], { limit: 2, cursor: 2 });
    expect(page.items).toEqual([3, 4]);
    expect(page.total).toBe(5);
    expect(page.nextCursor).toBe(4);
  });

  it("summarizes object keys without dumping full values", () => {
    expect(summarizeObject({ a: "long", b: 2, c: true, d: "extra" })).toBe("{a, b, c, ...}");
    expect(summarizeObject({})).toBe("{}");
  });

  it("tails logs and reports omitted line count", () => {
    const result = tailLines("one\ntwo\nthree\nfour", 2);
    expect(result.text).toBe("three\nfour");
    expect(result.omitted).toBe(2);
  });
});

import { describe, it, expect } from "bun:test";
import { isGhAuthenticated } from "./github-actions.js";

describe("github-actions", () => {
  it("isGhAuthenticated returns boolean", () => {
    const result = isGhAuthenticated();
    expect(typeof result).toBe("boolean");
  });

  it("module exports expected functions", async () => {
    const mod = await import("./github-actions.js");
    expect(typeof mod.triggerWorkflow).toBe("function");
    expect(typeof mod.getLatestRun).toBe("function");
    expect(typeof mod.getRunStatus).toBe("function");
    expect(typeof mod.getFailureLogs).toBe("function");
    expect(typeof mod.getAnnotations).toBe("function");
    expect(typeof mod.isGhAuthenticated).toBe("function");
  });
});

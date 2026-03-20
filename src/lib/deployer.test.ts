import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";

describe("deployer", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("exports deploy as a function", async () => {
    const { deploy } = await import("./deployer.js");
    expect(typeof deploy).toBe("function");
  });

  it("exports rollback as a function", async () => {
    const { rollback } = await import("./deployer.js");
    expect(typeof rollback).toBe("function");
  });

  it("exports promote as a function", async () => {
    const { promote } = await import("./deployer.js");
    expect(typeof promote).toBe("function");
  });

  it("exports getStatus as a function", async () => {
    const { getStatus } = await import("./deployer.js");
    expect(typeof getStatus).toBe("function");
  });

  it("exports getLogs as a function", async () => {
    const { getLogs } = await import("./deployer.js");
    expect(typeof getLogs).toBe("function");
  });
});

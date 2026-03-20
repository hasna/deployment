import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { FlyioProvider } from "./flyio.js";

describe("FlyioProvider", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("can be instantiated", () => {
    const provider = new FlyioProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new FlyioProvider();
    expect(provider.type).toBe("flyio");
  });

  it("connect throws without valid credentials", async () => {
    const provider = new FlyioProvider();
    await expect(provider.connect({})).rejects.toThrow("token is required");
  });

  it("connect throws with empty token", async () => {
    const provider = new FlyioProvider();
    await expect(provider.connect({ token: "" })).rejects.toThrow("token is required");
  });
});

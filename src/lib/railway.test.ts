import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { RailwayProvider } from "./railway.js";

describe("RailwayProvider", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("can be instantiated", () => {
    const provider = new RailwayProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new RailwayProvider();
    expect(provider.type).toBe("railway");
  });

  it("connect throws without valid credentials", async () => {
    const provider = new RailwayProvider();
    await expect(provider.connect({})).rejects.toThrow("token is required");
  });

  it("connect throws with empty token", async () => {
    const provider = new RailwayProvider();
    await expect(provider.connect({ token: "" })).rejects.toThrow("token is required");
  });
});

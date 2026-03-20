import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { VercelProvider } from "./vercel.js";

describe("VercelProvider", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("can be instantiated", () => {
    const provider = new VercelProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new VercelProvider();
    expect(provider.type).toBe("vercel");
  });

  it("connect throws without valid credentials", async () => {
    const provider = new VercelProvider();
    await expect(provider.connect({})).rejects.toThrow("token is required");
  });

  it("connect throws with empty token", async () => {
    const provider = new VercelProvider();
    await expect(provider.connect({ token: "" })).rejects.toThrow("token is required");
  });
});

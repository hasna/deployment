import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { DigitalOceanProvider } from "./digitalocean.js";

describe("DigitalOceanProvider", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("can be instantiated", () => {
    const provider = new DigitalOceanProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new DigitalOceanProvider();
    expect(provider.type).toBe("digitalocean");
  });

  it("connect throws without valid credentials", async () => {
    const provider = new DigitalOceanProvider();
    await expect(provider.connect({})).rejects.toThrow("token is required");
  });

  it("connect throws with empty token", async () => {
    const provider = new DigitalOceanProvider();
    await expect(provider.connect({ token: "" })).rejects.toThrow("token is required");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { CloudflareProvider } from "./cloudflare.js";

describe("CloudflareProvider", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("can be instantiated", () => {
    const provider = new CloudflareProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new CloudflareProvider();
    expect(provider.type).toBe("cloudflare");
  });

  it("connect throws without valid credentials", async () => {
    const provider = new CloudflareProvider();
    await expect(provider.connect({})).rejects.toThrow("token is required");
  });

  it("connect throws with token but no account_id", async () => {
    const provider = new CloudflareProvider();
    await expect(
      provider.connect({ token: "fake-token" })
    ).rejects.toThrow("account_id is required");
  });
});

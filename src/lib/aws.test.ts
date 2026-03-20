import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "../db/database.js";
import { AwsProvider } from "./aws.js";

describe("AwsProvider", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  it("can be instantiated", () => {
    const provider = new AwsProvider();
    expect(provider).toBeDefined();
  });

  it("has correct type property", () => {
    const provider = new AwsProvider();
    expect(provider.type).toBe("aws");
  });

  it("connect throws without valid credentials", async () => {
    const provider = new AwsProvider();
    await expect(provider.connect({})).rejects.toThrow(
      "access_key_id and secret_access_key are required"
    );
  });

  it("connect throws with only access_key_id", async () => {
    const provider = new AwsProvider();
    await expect(
      provider.connect({ access_key_id: "AKID" })
    ).rejects.toThrow("access_key_id and secret_access_key are required");
  });

  it("connect throws with only secret_access_key", async () => {
    const provider = new AwsProvider();
    await expect(
      provider.connect({ secret_access_key: "secret" })
    ).rejects.toThrow("access_key_id and secret_access_key are required");
  });
});

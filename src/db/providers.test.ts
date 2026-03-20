import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import {
  createProvider,
  getProvider,
  listProviders,
  updateProvider,
  deleteProvider,
} from "./providers.js";
import { ProviderNotFoundError } from "../types/index.js";

describe("providers", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("createProvider", () => {
    it("creates a provider with all fields", () => {
      const p = createProvider({
        name: "my-vercel",
        type: "vercel",
        credentials_key: "vercel-key",
        config: { team: "myteam" },
      });
      expect(p.id).toBeDefined();
      expect(p.name).toBe("my-vercel");
      expect(p.type).toBe("vercel");
      expect(p.credentials_key).toBe("vercel-key");
      expect(p.config).toEqual({ team: "myteam" });
      expect(p.created_at).toBeDefined();
      expect(p.updated_at).toBeDefined();
    });

    it("creates a provider with default config", () => {
      const p = createProvider({
        name: "basic-prov",
        type: "railway",
        credentials_key: "",
      });
      expect(p.config).toEqual({});
    });

    it("throws on invalid provider type", () => {
      expect(() =>
        createProvider({
          name: "bad",
          type: "invalid" as any,
          credentials_key: "",
        })
      ).toThrow("Invalid provider type");
    });

    it("allows all valid provider types", () => {
      const types = ["vercel", "cloudflare", "railway", "flyio", "aws", "digitalocean"] as const;
      for (const type of types) {
        const p = createProvider({
          name: `prov-${type}`,
          type,
          credentials_key: "",
        });
        expect(p.type).toBe(type);
      }
    });
  });

  describe("getProvider", () => {
    it("gets a provider by full ID", () => {
      const created = createProvider({
        name: "get-test",
        type: "aws",
        credentials_key: "",
      });
      const fetched = getProvider(created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("get-test");
    });

    it("gets a provider by partial ID", () => {
      const created = createProvider({
        name: "partial-prov",
        type: "flyio",
        credentials_key: "",
      });
      const prefix = created.id.substring(0, 8);
      const fetched = getProvider(prefix);
      expect(fetched.id).toBe(created.id);
    });

    it("throws ProviderNotFoundError for missing ID", () => {
      expect(() => getProvider("nonexistent")).toThrow(ProviderNotFoundError);
    });
  });

  describe("listProviders", () => {
    it("lists all providers", () => {
      createProvider({ name: "p1", type: "vercel", credentials_key: "" });
      createProvider({ name: "p2", type: "aws", credentials_key: "" });
      const providers = listProviders();
      expect(providers.length).toBe(2);
    });

    it("filters by type", () => {
      createProvider({ name: "v1", type: "vercel", credentials_key: "" });
      createProvider({ name: "a1", type: "aws", credentials_key: "" });
      const vercelProvs = listProviders({ type: "vercel" });
      expect(vercelProvs.length).toBe(1);
      expect(vercelProvs[0]!.type).toBe("vercel");
    });

    it("returns empty when no providers exist", () => {
      const providers = listProviders();
      expect(providers.length).toBe(0);
    });
  });

  describe("updateProvider", () => {
    it("updates provider name", () => {
      const p = createProvider({ name: "old-name", type: "vercel", credentials_key: "" });
      const updated = updateProvider(p.id, { name: "new-name" });
      expect(updated.name).toBe("new-name");
    });

    it("updates credentials_key", () => {
      const p = createProvider({ name: "cred-test", type: "vercel", credentials_key: "old" });
      const updated = updateProvider(p.id, { credentials_key: "new-key" });
      expect(updated.credentials_key).toBe("new-key");
    });

    it("updates config", () => {
      const p = createProvider({ name: "cfg-test", type: "vercel", credentials_key: "" });
      const updated = updateProvider(p.id, { config: { team: "updated" } });
      expect(updated.config).toEqual({ team: "updated" });
    });

    it("throws ProviderNotFoundError for nonexistent provider", () => {
      expect(() => updateProvider("nonexistent", { name: "x" })).toThrow(
        ProviderNotFoundError
      );
    });
  });

  describe("deleteProvider", () => {
    it("deletes a provider", () => {
      const p = createProvider({ name: "del-test", type: "vercel", credentials_key: "" });
      deleteProvider(p.id);
      expect(() => getProvider(p.id)).toThrow(ProviderNotFoundError);
    });

    it("throws ProviderNotFoundError for nonexistent provider", () => {
      expect(() => deleteProvider("nonexistent")).toThrow(ProviderNotFoundError);
    });
  });
});

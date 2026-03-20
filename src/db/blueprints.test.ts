import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import {
  createBlueprint,
  getBlueprint,
  listBlueprints,
  updateBlueprint,
  deleteBlueprint,
} from "./blueprints.js";
import { BlueprintNotFoundError } from "../types/index.js";
import type { BlueprintTemplate } from "../types/index.js";

const sampleTemplate: BlueprintTemplate = {
  resources: [
    { type: "database", name: "postgres", config: { engine: "pg" } },
  ],
  env_vars: { NODE_ENV: "production" },
  deploy_config: { framework: "nextjs" },
};

describe("blueprints", () => {
  beforeEach(() => {
    process.env["OPEN_DEPLOYMENT_DB"] = ":memory:";
  });

  afterEach(() => {
    resetDatabase();
    closeDatabase();
    delete process.env["OPEN_DEPLOYMENT_DB"];
  });

  describe("createBlueprint", () => {
    it("creates a blueprint with all fields", () => {
      const bp = createBlueprint({
        name: "nextjs-vercel",
        description: "Next.js on Vercel",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      expect(bp.id).toBeDefined();
      expect(bp.name).toBe("nextjs-vercel");
      expect(bp.description).toBe("Next.js on Vercel");
      expect(bp.provider_type).toBe("vercel");
      expect(bp.template).toEqual(sampleTemplate);
      expect(bp.created_at).toBeDefined();
      expect(bp.updated_at).toBeDefined();
    });

    it("creates a blueprint with default description", () => {
      const bp = createBlueprint({
        name: "minimal-bp",
        provider_type: "aws",
        template: { resources: [], env_vars: {}, deploy_config: {} },
      });
      expect(bp.description).toBe("");
    });
  });

  describe("getBlueprint", () => {
    it("gets a blueprint by ID", () => {
      const created = createBlueprint({
        name: "by-id-bp",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      const fetched = getBlueprint(created.id);
      expect(fetched.id).toBe(created.id);
    });

    it("gets a blueprint by name", () => {
      createBlueprint({
        name: "by-name-bp",
        provider_type: "cloudflare",
        template: sampleTemplate,
      });
      const fetched = getBlueprint("by-name-bp");
      expect(fetched.name).toBe("by-name-bp");
    });

    it("throws BlueprintNotFoundError for missing blueprint", () => {
      expect(() => getBlueprint("nonexistent")).toThrow(BlueprintNotFoundError);
    });
  });

  describe("listBlueprints", () => {
    it("lists all blueprints", () => {
      createBlueprint({
        name: "bp1",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      createBlueprint({
        name: "bp2",
        provider_type: "aws",
        template: sampleTemplate,
      });
      const bps = listBlueprints();
      expect(bps.length).toBe(2);
    });

    it("filters by provider_type", () => {
      createBlueprint({
        name: "vercel-bp",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      createBlueprint({
        name: "aws-bp",
        provider_type: "aws",
        template: sampleTemplate,
      });
      const vercelBps = listBlueprints({ provider_type: "vercel" });
      expect(vercelBps.length).toBe(1);
      expect(vercelBps[0]!.provider_type).toBe("vercel");
    });

    it("returns empty when no blueprints exist", () => {
      const bps = listBlueprints();
      expect(bps.length).toBe(0);
    });
  });

  describe("updateBlueprint", () => {
    it("updates blueprint name", () => {
      const bp = createBlueprint({
        name: "old-bp",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      const updated = updateBlueprint(bp.id, { name: "new-bp" });
      expect(updated.name).toBe("new-bp");
    });

    it("updates description", () => {
      const bp = createBlueprint({
        name: "desc-bp",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      const updated = updateBlueprint(bp.id, { description: "Updated description" });
      expect(updated.description).toBe("Updated description");
    });

    it("updates template", () => {
      const bp = createBlueprint({
        name: "tmpl-bp",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      const newTemplate: BlueprintTemplate = {
        resources: [],
        env_vars: { NEW_VAR: "true" },
        deploy_config: {},
      };
      const updated = updateBlueprint(bp.id, { template: newTemplate });
      expect(updated.template).toEqual(newTemplate);
    });

    it("throws BlueprintNotFoundError for nonexistent blueprint", () => {
      expect(() => updateBlueprint("nonexistent", { name: "x" })).toThrow(
        BlueprintNotFoundError
      );
    });
  });

  describe("deleteBlueprint", () => {
    it("deletes a blueprint", () => {
      const bp = createBlueprint({
        name: "del-bp",
        provider_type: "vercel",
        template: sampleTemplate,
      });
      deleteBlueprint(bp.id);
      expect(() => getBlueprint(bp.id)).toThrow(BlueprintNotFoundError);
    });

    it("throws BlueprintNotFoundError for nonexistent blueprint", () => {
      expect(() => deleteBlueprint("nonexistent")).toThrow(BlueprintNotFoundError);
    });
  });
});

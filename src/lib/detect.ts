import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderType } from "../types/index.js";

export interface DetectionResult {
  type: string;
  framework: string;
  suggestedProvider: ProviderType;
  suggestedBlueprint: string;
  confidence: "high" | "medium" | "low";
  detectedFiles: string[];
}

interface DetectionRule {
  files: string[];
  type: string;
  framework: string;
  suggestedProvider: ProviderType;
  suggestedBlueprint: string;
  confidence: "high" | "medium" | "low";
  priority: number;
}

const RULES: DetectionRule[] = [
  {
    files: ["next.config.js", "next.config.mjs", "next.config.ts"],
    type: "web",
    framework: "nextjs",
    suggestedProvider: "vercel",
    suggestedBlueprint: "nextjs-vercel",
    confidence: "high",
    priority: 10,
  },
  {
    files: ["wrangler.toml", "wrangler.json"],
    type: "worker",
    framework: "cloudflare-workers",
    suggestedProvider: "cloudflare",
    suggestedBlueprint: "static-cloudflare",
    confidence: "high",
    priority: 10,
  },
  {
    files: ["fly.toml"],
    type: "container",
    framework: "fly",
    suggestedProvider: "flyio",
    suggestedBlueprint: "docker-flyio",
    confidence: "high",
    priority: 10,
  },
  {
    files: ["railway.toml", "railway.json"],
    type: "service",
    framework: "railway",
    suggestedProvider: "railway",
    suggestedBlueprint: "node-railway",
    confidence: "high",
    priority: 10,
  },
  {
    files: ["appspec.yml", "buildspec.yml", "taskdef.json"],
    type: "container",
    framework: "aws-ecs",
    suggestedProvider: "aws",
    suggestedBlueprint: "fullstack-aws",
    confidence: "high",
    priority: 9,
  },
  {
    files: [".do/app.yaml", "do.yaml"],
    type: "app-platform",
    framework: "digitalocean",
    suggestedProvider: "digitalocean",
    suggestedBlueprint: "app-digitalocean",
    confidence: "high",
    priority: 9,
  },
  {
    files: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml"],
    type: "container",
    framework: "docker",
    suggestedProvider: "flyio",
    suggestedBlueprint: "docker-flyio",
    confidence: "medium",
    priority: 5,
  },
  {
    files: ["vercel.json"],
    type: "web",
    framework: "vercel",
    suggestedProvider: "vercel",
    suggestedBlueprint: "nextjs-vercel",
    confidence: "high",
    priority: 8,
  },
  {
    files: ["nuxt.config.ts", "nuxt.config.js"],
    type: "web",
    framework: "nuxt",
    suggestedProvider: "vercel",
    suggestedBlueprint: "nextjs-vercel",
    confidence: "medium",
    priority: 7,
  },
  {
    files: ["astro.config.mjs", "astro.config.ts"],
    type: "web",
    framework: "astro",
    suggestedProvider: "cloudflare",
    suggestedBlueprint: "static-cloudflare",
    confidence: "medium",
    priority: 7,
  },
  {
    files: ["svelte.config.js"],
    type: "web",
    framework: "sveltekit",
    suggestedProvider: "vercel",
    suggestedBlueprint: "nextjs-vercel",
    confidence: "medium",
    priority: 7,
  },
  {
    files: ["remix.config.js", "remix.config.ts"],
    type: "web",
    framework: "remix",
    suggestedProvider: "vercel",
    suggestedBlueprint: "nextjs-vercel",
    confidence: "medium",
    priority: 7,
  },
  {
    files: ["Procfile"],
    type: "service",
    framework: "procfile",
    suggestedProvider: "railway",
    suggestedBlueprint: "node-railway",
    confidence: "low",
    priority: 3,
  },
  {
    files: ["package.json"],
    type: "service",
    framework: "node",
    suggestedProvider: "railway",
    suggestedBlueprint: "node-railway",
    confidence: "low",
    priority: 1,
  },
];

export function detectProjectType(path: string): DetectionResult {
  const matches: (DetectionRule & { detectedFiles: string[] })[] = [];

  for (const rule of RULES) {
    const found: string[] = [];
    for (const file of rule.files) {
      if (existsSync(join(path, file))) {
        found.push(file);
      }
    }
    if (found.length > 0) {
      matches.push({ ...rule, detectedFiles: found });
    }
  }

  if (matches.length === 0) {
    return {
      type: "unknown",
      framework: "unknown",
      suggestedProvider: "railway",
      suggestedBlueprint: "node-railway",
      confidence: "low",
      detectedFiles: [],
    };
  }

  matches.sort((a, b) => b.priority - a.priority);
  const best = matches[0]!;

  return {
    type: best.type,
    framework: best.framework,
    suggestedProvider: best.suggestedProvider,
    suggestedBlueprint: best.suggestedBlueprint,
    confidence: best.confidence,
    detectedFiles: best.detectedFiles,
  };
}

export function detectAllMatches(path: string): DetectionResult[] {
  const results: DetectionResult[] = [];

  for (const rule of RULES) {
    const found: string[] = [];
    for (const file of rule.files) {
      if (existsSync(join(path, file))) {
        found.push(file);
      }
    }
    if (found.length > 0) {
      results.push({
        type: rule.type,
        framework: rule.framework,
        suggestedProvider: rule.suggestedProvider,
        suggestedBlueprint: rule.suggestedBlueprint,
        confidence: rule.confidence,
        detectedFiles: found,
      });
    }
  }

  return results;
}

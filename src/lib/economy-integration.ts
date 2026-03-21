import type { HookContext } from "./hooks.js";

let economyAvailable = false;
let economyModule: {
  trackCost: (opts: Record<string, unknown>) => unknown;
} | null = null;

async function loadEconomy(): Promise<void> {
  if (economyModule) return;
  try {
    economyModule = await import("@hasna/economy") as any;
    economyAvailable = true;
  } catch {
    economyAvailable = false;
  }
}

export async function trackDeploymentCost(
  context: HookContext,
  cost?: number
): Promise<void> {
  await loadEconomy();
  if (!economyAvailable || !economyModule) return;

  try {
    economyModule.trackCost({
      project: context.project_name,
      environment: context.environment_name,
      provider: context.provider_type,
      deployment_id: context.deployment_id,
      cost: cost ?? 0,
      timestamp: new Date().toISOString(),
      type: "deployment",
    });
  } catch {
    // Silently ignore — economy tracking is optional
  }
}

export function isEconomyAvailable(): boolean {
  return economyAvailable;
}

import type { HookContext } from "./hooks.js";

let conversationsAvailable = false;
let conversationsModule: {
  send_message: (opts: { space: string; text: string }) => unknown;
} | null = null;

async function loadConversations(): Promise<void> {
  if (conversationsModule) return;
  try {
    conversationsModule = await import("@hasna/conversations") as any;
    conversationsAvailable = true;
  } catch {
    conversationsAvailable = false;
  }
}

export async function announceDeployment(context: HookContext): Promise<void> {
  await loadConversations();
  if (!conversationsAvailable || !conversationsModule) return;

  const msg = `✓ Deployed **${context.project_name}** → **${context.environment_name}** (${context.environment_type})\n` +
    `  Provider: ${context.provider_type}\n` +
    (context.url ? `  URL: ${context.url}\n` : "") +
    (context.version ? `  Version: ${context.version}\n` : "") +
    (context.commit_sha ? `  Commit: ${context.commit_sha.slice(0, 8)}\n` : "");

  try {
    conversationsModule.send_message({
      space: context.project_name,
      text: msg,
    });
  } catch {
    // Silently ignore — conversations is optional
  }
}

export async function announceRollback(context: HookContext): Promise<void> {
  await loadConversations();
  if (!conversationsAvailable || !conversationsModule) return;

  const msg = `⟲ Rolled back **${context.project_name}** → **${context.environment_name}**\n` +
    (context.version ? `  Rolled back from: ${context.version}\n` : "");

  try {
    conversationsModule.send_message({
      space: context.project_name,
      text: msg,
    });
  } catch {
    // Silently ignore
  }
}

export async function announceFailure(context: HookContext): Promise<void> {
  await loadConversations();
  if (!conversationsAvailable || !conversationsModule) return;

  const msg = `✗ Deploy FAILED **${context.project_name}** → **${context.environment_name}**\n` +
    (context.error ? `  Error: ${context.error}\n` : "") +
    (context.version ? `  Version: ${context.version}\n` : "");

  try {
    conversationsModule.send_message({
      space: context.project_name,
      text: msg,
    });
  } catch {
    // Silently ignore
  }
}

export function isConversationsAvailable(): boolean {
  return conversationsAvailable;
}

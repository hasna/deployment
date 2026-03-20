import type { DeploymentProviderInterface } from "../types/index.js";

export interface DeploymentSecrets {
  credentials: Record<string, string>;
  envVars: Record<string, string>;
}

let secretsAvailable = false;
let secretsModule: {
  getSecret: (key: string) => { value: string } | undefined;
  listSecrets: (namespace?: string) => { key: string; value: string }[];
  setSecret: (key: string, value: string, type?: string, label?: string) => unknown;
} | null = null;

async function loadSecrets(): Promise<void> {
  if (secretsModule) return;
  try {
    secretsModule = await import("@hasna/secrets/dist/store.js");
    secretsAvailable = true;
  } catch {
    secretsAvailable = false;
  }
}

export function getDeploymentSecrets(
  projectName: string,
  envName: string
): DeploymentSecrets {
  if (!secretsAvailable || !secretsModule) {
    return { credentials: {}, envVars: {} };
  }

  const credentials: Record<string, string> = {};
  const envVars: Record<string, string> = {};

  // Load provider credentials: deployment/{project}/credentials/*
  const credSecrets = secretsModule.listSecrets(`deployment/${projectName}/credentials`);
  for (const s of credSecrets) {
    const key = s.key.split("/").pop() ?? s.key;
    credentials[key] = s.value;
  }

  // Load environment variables: deployment/{project}/{env}/*
  const envSecrets = secretsModule.listSecrets(`deployment/${projectName}/${envName}`);
  for (const s of envSecrets) {
    const key = s.key.split("/").pop() ?? s.key;
    envVars[key] = s.value;
  }

  return { credentials, envVars };
}

export function setDeploymentSecret(
  projectName: string,
  envName: string,
  key: string,
  value: string,
  type?: string
): void {
  if (!secretsAvailable || !secretsModule) {
    throw new Error(
      "@hasna/secrets not available. Install with: bun install -g @hasna/secrets"
    );
  }
  secretsModule.setSecret(
    `deployment/${projectName}/${envName}/${key}`,
    value,
    type ?? "other",
    `${projectName} ${envName} ${key}`
  );
}

export function listDeploymentSecrets(
  projectName: string,
  envName?: string
): { key: string; value: string }[] {
  if (!secretsAvailable || !secretsModule) return [];

  const namespace = envName
    ? `deployment/${projectName}/${envName}`
    : `deployment/${projectName}`;

  return secretsModule.listSecrets(namespace).map((s) => ({
    key: s.key,
    value: s.value,
  }));
}

export async function injectSecretsToProvider(
  provider: DeploymentProviderInterface,
  projectName: string,
  envName: string
): Promise<void> {
  const { envVars } = getDeploymentSecrets(projectName, envName);

  if (Object.keys(envVars).length === 0) return;

  await provider.setEnvVars(projectName, envVars);
}

export async function initSecrets(): Promise<boolean> {
  await loadSecrets();
  return secretsAvailable;
}

export function isSecretsAvailable(): boolean {
  return secretsAvailable;
}

declare module "@hasna/secrets/dist/store.js" {
  export function getSecret(key: string): { value: string } | undefined;
  export function listSecrets(namespace?: string): { key: string; value: string }[];
  export function setSecret(key: string, value: string, type?: string, label?: string): unknown;
}

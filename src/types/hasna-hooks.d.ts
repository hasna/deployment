declare module "@hasna/hooks" {
  export function runHook(
    name: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<{
    output: Record<string, unknown>;
    stderr: string;
    exitCode: number;
  }>;
}

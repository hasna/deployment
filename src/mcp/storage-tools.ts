import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  STORAGE_TABLES,
  getStorageStatus,
  storagePull,
  storagePush,
  storageSync,
} from "../db/storage-sync.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true as const,
  };
}

const STORAGE_TABLE_SCHEMA = z.enum(STORAGE_TABLES);

export function registerDeploymentStorageTools(server: McpServer): void {
  server.tool("storage_status", "Show deployment remote storage configuration and local sync history", {}, async () =>
    json(getStorageStatus())
  );

  server.tool(
    "storage_push",
    "Push local deployment data to remote PostgreSQL storage",
    { tables: z.array(STORAGE_TABLE_SCHEMA).optional() },
    async (args) => {
      try {
        return json(await storagePush({ tables: args.tables }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "storage_pull",
    "Pull deployment data from remote PostgreSQL storage to local SQLite",
    { tables: z.array(STORAGE_TABLE_SCHEMA).optional() },
    async (args) => {
      try {
        return json(await storagePull({ tables: args.tables }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "storage_sync",
    "Bidirectional deployment storage sync: pull then push",
    { tables: z.array(STORAGE_TABLE_SCHEMA).optional() },
    async (args) => {
      try {
        return json(await storageSync({ tables: args.tables }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}

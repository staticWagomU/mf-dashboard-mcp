import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { FinanceGroup } from "./database.js";
import { QUERY_MAX_SQL_LENGTH, type QueryResult } from "./query-sandbox.js";

export interface FinanceDataAccess {
  describeSchema(): string;
  listGroups(): Promise<FinanceGroup[]>;
  query(input: { groupId: string; sql: string }): Promise<QueryResult>;
}

export function registerFinanceTools(server: McpServer, dataAccess: FinanceDataAccess): void {
  server.registerTool(
    "list_finance_groups",
    {
      description: "List the mf-dashboard groups available for scoped finance queries.",
      annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: true },
    },
    async () => {
      const structuredContent = { groups: await dataAccess.listGroups() };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    "get_finance_schema",
    {
      description: "Describe the group-scoped tables, columns, and finance semantics.",
      annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: true },
    },
    async () => ({
      content: [{ type: "text" as const, text: dataAccess.describeSchema() }],
    }),
  );

  server.registerTool(
    "query_finance",
    {
      description:
        "Run one read-only SQL query against a selected finance group. Call get_finance_schema first.",
      inputSchema: z.object({
        groupId: z.string().trim().min(1).describe("ID returned by list_finance_groups"),
        sql: z.string().trim().min(1).max(QUERY_MAX_SQL_LENGTH),
      }),
      annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: true },
    },
    async ({ groupId, sql }) => {
      const result = await dataAccess.query({ groupId, sql });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: { ...result },
      };
    },
  );
}

import { McpServer } from "@modelcontextprotocol/server";
import type { FinanceDataAccess } from "./tools.js";
import { registerFinanceTools } from "./tools.js";

export function createFinanceMcpServer(dataAccess: FinanceDataAccess): McpServer {
  const server = new McpServer(
    { name: "mf-dashboard-mcp", version: "0.1.0" },
    {
      instructions: [
        "Read local mf-dashboard finance data through group-scoped, read-only SQL.",
        "Call list_finance_groups and get_finance_schema before query_finance.",
        "Descriptions, account names, and amounts are sensitive raw data. Request only what the user needs.",
        "Money Forward IDs are anonymized and credential or arbitrary-file tools are not available.",
      ].join("\n"),
    },
  );

  registerFinanceTools(server, dataAccess);
  return server;
}

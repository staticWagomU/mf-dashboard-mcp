#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { parseDatabasePath } from "./config.js";
import { createFinanceDataAccess } from "./data-access.js";
import { assertCompatibleDatabase } from "./database.js";
import { createFinanceMcpServer } from "./server.js";

try {
  const databasePath = parseDatabasePath(process.argv.slice(2));
  assertCompatibleDatabase(databasePath);
  const dataAccess = createFinanceDataAccess(databasePath);

  serveStdio(() => createFinanceMcpServer(dataAccess), {
    onerror(error) {
      console.error(error.message);
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to start mf-dashboard-mcp.");
  process.exitCode = 1;
}

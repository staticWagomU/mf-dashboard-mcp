import { statSync } from "node:fs";
import { isAbsolute } from "node:path";

export function parseDatabasePath(args: string[]): string {
  if (args.length !== 2 || args[0] !== "--database" || args[1] === undefined) {
    throw new Error("Usage: mf-dashboard-mcp --database /absolute/path/to/moneyforward.db");
  }

  const databasePath = args[1];
  if (!isAbsolute(databasePath)) {
    throw new Error("--database must be an absolute path.");
  }

  try {
    if (statSync(databasePath).isFile()) return databasePath;
  } catch {
    // Return a stable error without leaking additional filesystem details.
  }

  throw new Error("--database must point to an existing database file.");
}

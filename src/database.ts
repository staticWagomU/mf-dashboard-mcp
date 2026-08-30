import { DatabaseSync } from "node:sqlite";

const REQUIRED_TABLES = ["accounts", "group_accounts", "groups", "transactions"] as const;

export interface FinanceGroup {
  id: string;
  name: string;
}

function openReadOnly(databasePath: string): DatabaseSync {
  return new DatabaseSync(databasePath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    readOnly: true,
    timeout: 1_000,
  });
}

export function assertCompatibleDatabase(databasePath: string): void {
  const database = openReadOnly(databasePath);

  try {
    const rows = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableNames = new Set(rows.map(({ name }) => name));
    const missing = REQUIRED_TABLES.filter((table) => !tableNames.has(table));

    if (missing.length > 0) {
      throw new Error(`Unsupported mf-dashboard database: missing ${missing.join(", ")}.`);
    }
  } finally {
    database.close();
  }
}

export function listFinanceGroups(databasePath: string): FinanceGroup[] {
  const database = openReadOnly(databasePath);

  try {
    return database
      .prepare(
        `SELECT id, name
         FROM groups
         ORDER BY is_current DESC, last_scraped_at DESC`,
      )
      .all() as unknown as FinanceGroup[];
  } finally {
    database.close();
  }
}

export function transactionHasFirstSeenAt(databasePath: string): boolean {
  const database = openReadOnly(databasePath);

  try {
    const row = database
      .prepare("SELECT 1 AS present FROM pragma_table_info('transactions') WHERE name = ?")
      .get("first_seen_at");
    return row !== undefined;
  } finally {
    database.close();
  }
}

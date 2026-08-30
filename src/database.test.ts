import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertCompatibleDatabase,
  listFinanceGroups,
  transactionHasFirstSeenAt,
} from "./database.js";

describe("mf-dashboard database access", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  function createDatabase(options: { firstSeenAt?: boolean } = {}): string {
    const directory = mkdtempSync(join(tmpdir(), "mf-dashboard-mcp-db-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "moneyforward.db");
    const database = new DatabaseSync(databasePath);
    const firstSeenAt = options.firstSeenAt ? ", first_seen_at TEXT" : "";

    database.exec(`
      CREATE TABLE groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        is_current INTEGER NOT NULL,
        last_scraped_at TEXT
      );
      CREATE TABLE accounts (id INTEGER PRIMARY KEY);
      CREATE TABLE group_accounts (group_id TEXT, account_id INTEGER);
      CREATE TABLE transactions (id INTEGER PRIMARY KEY${firstSeenAt});
      INSERT INTO groups VALUES ('personal', 'Personal', 1, '2026-08-31');
      INSERT INTO groups VALUES ('archive', 'Archive', 0, '2026-08-30');
    `);
    database.close();
    return databasePath;
  }

  test("validates the minimum mf-dashboard schema", () => {
    expect(() => assertCompatibleDatabase(createDatabase())).not.toThrow();
  });

  test("rejects an unrelated SQLite database", () => {
    const directory = mkdtempSync(join(tmpdir(), "mf-dashboard-mcp-invalid-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "other.db");
    new DatabaseSync(databasePath).close();

    expect(() => assertCompatibleDatabase(databasePath)).toThrow("Unsupported mf-dashboard");
  });

  test("lists current groups first", () => {
    expect(listFinanceGroups(createDatabase())).toEqual([
      { id: "personal", name: "Personal" },
      { id: "archive", name: "Archive" },
    ]);
  });

  test("detects first_seen_at without requiring the mf-dashboard fork", () => {
    expect(transactionHasFirstSeenAt(createDatabase())).toBe(false);
    expect(transactionHasFirstSeenAt(createDatabase({ firstSeenAt: true }))).toBe(true);
  });
});

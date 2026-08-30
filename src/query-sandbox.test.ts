import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createReadOnlyDatabaseUri,
  normalizeReadOnlySql,
  runReadOnlyQuery,
} from "./query-sandbox.js";

describe("read-only query sandbox", () => {
  let directory: string;
  let databasePath: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "mf-dashboard-mcp-query-"));
    databasePath = join(directory, "moneyforward.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT, is_current INTEGER, last_scraped_at TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE group_accounts (id INTEGER, group_id TEXT, account_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE institution_categories (id INTEGER, name TEXT);
      CREATE TABLE accounts (id INTEGER PRIMARY KEY, mf_id TEXT, name TEXT, type TEXT, institution TEXT, category_id INTEGER, created_at TEXT, updated_at TEXT, is_active INTEGER);
      CREATE TABLE asset_categories (id INTEGER, name TEXT);
      CREATE TABLE account_statuses (id INTEGER, account_id INTEGER, status TEXT);
      CREATE TABLE daily_snapshots (id INTEGER, group_id TEXT, date TEXT, refresh_completed INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE holdings (id INTEGER, mf_id TEXT, account_id INTEGER, category_id INTEGER, name TEXT, code TEXT, type TEXT, liability_category TEXT, created_at TEXT, updated_at TEXT, is_active INTEGER);
      CREATE TABLE holding_values (id INTEGER, holding_id INTEGER, snapshot_id INTEGER, amount INTEGER);
      CREATE TABLE transactions (id INTEGER, mf_id TEXT, date TEXT, account_id INTEGER, category TEXT, sub_category TEXT, description TEXT, amount INTEGER, type TEXT, is_transfer INTEGER, is_excluded_from_calculation INTEGER, transfer_target TEXT, transfer_target_account_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE asset_history (id INTEGER, group_id TEXT, date TEXT, total_assets INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE asset_history_categories (id INTEGER, asset_history_id INTEGER, category_name TEXT, amount INTEGER);
      CREATE TABLE spending_targets (id INTEGER, group_id TEXT, category TEXT, amount INTEGER);

      INSERT INTO groups VALUES ('personal', 'Personal', 1, '2026-08-31', '', '');
      INSERT INTO groups VALUES ('other', 'Other', 0, '2026-08-30', '', '');
      INSERT INTO accounts VALUES (1, 'mf-account-1', 'Main', 'bank', 'Bank', NULL, '', '', 1);
      INSERT INTO accounts VALUES (2, 'mf-account-2', 'Other', 'bank', 'Bank', NULL, '', '', 1);
      INSERT INTO group_accounts VALUES (1, 'personal', 1, '', '');
      INSERT INTO group_accounts VALUES (2, 'other', 2, '', '');
      INSERT INTO transactions VALUES (1, 'mf-tx-1', '2026-08-30', 1, 'Food', 'Cafe', 'Coffee', 500, 'expense', 0, 0, NULL, NULL, '', '');
      INSERT INTO transactions VALUES (2, 'mf-tx-2', '2026-08-30', 2, 'Other', 'Other', 'Hidden', 999, 'expense', 0, 0, NULL, NULL, '', '');
    `);
    database.close();
  });

  afterAll(() => rmSync(directory, { force: true, recursive: true }));

  test("normalizes one SELECT statement", () => {
    expect(normalizeReadOnlySql(" SELECT 'semi;colon' AS value; ")).toBe(
      "SELECT 'semi;colon' AS value",
    );
  });

  test.each([
    "DELETE FROM transactions",
    "SELECT 1; SELECT 2",
    "ATTACH DATABASE '/tmp/other.db' AS other",
    "SELECT readfile('/etc/passwd')",
    "WITH RECURSIVE numbers AS (SELECT 1) SELECT * FROM numbers",
  ])("rejects unsafe SQL: %s", (sql) => {
    expect(() => normalizeReadOnlySql(sql)).toThrow();
  });

  test("returns only selected-group data and anonymizes raw IDs", async () => {
    await expect(
      runReadOnlyQuery(
        databasePath,
        "SELECT description, amount, mf_id, first_seen_at FROM transactions ORDER BY id",
        "personal",
      ),
    ).resolves.toEqual({
      columns: ["description", "amount", "mf_id", "first_seen_at"],
      rowCount: 1,
      rows: [{ amount: 500, description: "Coffee", first_seen_at: null, mf_id: null }],
      truncated: false,
    });
  });

  test("binds the selected group as :groupId", async () => {
    const result = await runReadOnlyQuery(databasePath, "SELECT :groupId AS group_id", "personal");
    expect(result.rows).toEqual([{ group_id: "personal" }]);
  });

  test("does not mutate the source database", async () => {
    await expect(
      runReadOnlyQuery(databasePath, "UPDATE transactions SET amount = 0", "personal"),
    ).rejects.toThrow("read-only SQL");

    const database = new DatabaseSync(databasePath, { readOnly: true });
    expect(database.prepare("SELECT amount FROM transactions WHERE id = 1").get()).toEqual({
      amount: 500,
    });
    database.close();
  });

  test("opens the attached source database in SQLite read-only mode", () => {
    const database = new DatabaseSync(":memory:");
    database.prepare("ATTACH DATABASE ? AS source").run(createReadOnlyDatabaseUri(databasePath));

    expect(() => database.exec("UPDATE source.transactions SET amount = 0")).toThrow(/readonly/i);
    database.close();
  });
});

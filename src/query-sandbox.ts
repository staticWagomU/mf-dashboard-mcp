import { spawn } from "node:child_process";
import { transactionHasFirstSeenAt } from "./database.js";

export const QUERY_MAX_ROWS = 200;
export const QUERY_MAX_BYTES = 64 * 1024;
export const QUERY_MAX_SQL_LENGTH = 5_000;
export const QUERY_TIMEOUT_MS = 1_000;

const SETUP_TIMEOUT_MS = 5_000;
const MAX_COLUMNS = 32;
const MAX_SQLITE_HEAP_BYTES = 64 * 1024 * 1024;
const WRITE_KEYWORDS =
  /\b(?:alter|analyze|attach|create|delete|detach|drop|insert|pragma|reindex|release|rollback|savepoint|update|vacuum)\b/i;
const WRITE_REPLACE_STATEMENT = /\breplace\b(?!\s*\()/i;
const EXPENSIVE_SQL =
  /\b(?:cross\s+join|group_concat|hex|json_group_array|json_group_object|printf|randomblob|zeroblob|with\s+recursive)\b/i;
const FILESYSTEM_SQL_FUNCTIONS = /\b(?:load_extension|readfile|writefile)\s*\(/i;

export interface QueryResult {
  columns: string[];
  rowCount: number;
  rows: Record<string, unknown>[];
  truncated: boolean;
}

function getQuotedTextEnd(sql: string, start: number): number {
  const closingCharacter = sql[start] === "[" ? "]" : sql[start]!;
  let index = start + 1;

  while (index < sql.length) {
    if (sql[index] !== closingCharacter) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === closingCharacter) {
      index += 2;
      continue;
    }
    return index + 1;
  }

  return sql.length;
}

function maskCommentsAndQuotedText(sql: string): string {
  let result = "";
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (character === "-" && next === "-") {
      const lineEnd = sql.indexOf("\n", index + 2);
      const end = lineEnd === -1 ? sql.length : lineEnd;
      result += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (character === "/" && next === "*") {
      const commentEnd = sql.indexOf("*/", index + 2);
      const end = commentEnd === -1 ? sql.length : commentEnd + 2;
      result += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (character === "'" || character === '"' || character === "`" || character === "[") {
      const end = getQuotedTextEnd(sql, index);
      result += " ".repeat(end - index);
      index = end;
      continue;
    }

    result += character;
    index += 1;
  }

  return result;
}

export function normalizeReadOnlySql(sql: string): string {
  let normalized = sql.trim();
  let masked = maskCommentsAndQuotedText(normalized);
  const trailingIndex = masked.trimEnd().length - 1;

  if (normalized[trailingIndex] === ";") {
    normalized = normalized.slice(0, trailingIndex) + normalized.slice(trailingIndex + 1);
    masked = maskCommentsAndQuotedText(normalized);
  }

  if (normalized.length > QUERY_MAX_SQL_LENGTH) {
    throw new Error(`SQL must be at most ${QUERY_MAX_SQL_LENGTH} characters.`);
  }
  if (!/^\s*(?:select|with)\b/i.test(masked)) {
    throw new Error("Only read-only SQL beginning with SELECT or WITH is allowed.");
  }
  if (masked.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }
  if (WRITE_KEYWORDS.test(masked) || WRITE_REPLACE_STATEMENT.test(masked)) {
    throw new Error("SQL that can modify a database is not allowed.");
  }
  if (EXPENSIVE_SQL.test(masked)) {
    throw new Error("This SQL operation is too expensive for the query sandbox.");
  }
  if (FILESYSTEM_SQL_FUNCTIONS.test(masked)) {
    throw new Error("SQL functions that access the filesystem are not allowed.");
  }

  return normalized;
}

function quoteSqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createScopedDatabaseSql(
  databasePath: string,
  groupId: string,
  hasFirstSeenAt: boolean,
): string {
  const sourceDatabase = quoteSqlText(databasePath);
  const selectedGroup = quoteSqlText(groupId);
  const globalSnapshotGroup = quoteSqlText("0");
  const firstSeenAt = hasFirstSeenAt ? "first_seen_at" : "NULL AS first_seen_at";
  const accountIds = `
    SELECT account_id FROM source.group_accounts WHERE group_id = ${selectedGroup}
    UNION
    SELECT id FROM source.accounts
    WHERE mf_id = 'unknown' AND ${selectedGroup} = ${globalSnapshotGroup}
  `;
  const groupHoldingIds = `SELECT id FROM source.holdings WHERE account_id IN (${accountIds})`;
  const latestHoldingSnapshotId = `
    SELECT id FROM source.daily_snapshots
    WHERE group_id = ${globalSnapshotGroup} AND refresh_completed = 1
    ORDER BY date DESC, id DESC LIMIT 1
  `;
  const assetHistoryIds = `SELECT id FROM source.asset_history WHERE group_id = ${selectedGroup}`;

  return `
    ATTACH DATABASE ${sourceDatabase} AS source;
    BEGIN;
    CREATE TABLE groups AS SELECT * FROM source.groups WHERE id = ${selectedGroup};
    CREATE TABLE group_accounts AS
      SELECT * FROM source.group_accounts WHERE group_id = ${selectedGroup};
    CREATE TABLE institution_categories AS SELECT * FROM source.institution_categories;
    CREATE TABLE accounts AS
      SELECT id, NULL AS mf_id, name, type, institution, category_id, created_at, updated_at, is_active
      FROM source.accounts WHERE id IN (${accountIds});
    CREATE TABLE asset_categories AS SELECT * FROM source.asset_categories;
    CREATE TABLE account_statuses AS
      SELECT * FROM source.account_statuses WHERE account_id IN (${accountIds});
    CREATE TABLE daily_snapshots AS
      SELECT id, ${selectedGroup} AS group_id, date, refresh_completed, created_at, updated_at
      FROM source.daily_snapshots WHERE id IN (${latestHoldingSnapshotId});
    CREATE TABLE holding_values AS
      SELECT * FROM source.holding_values
      WHERE snapshot_id IN (${latestHoldingSnapshotId}) AND holding_id IN (${groupHoldingIds});
    CREATE TABLE holdings AS
      SELECT id, NULL AS mf_id, account_id, category_id, name, code, type,
             liability_category, created_at, updated_at, is_active
      FROM source.holdings WHERE id IN (SELECT holding_id FROM holding_values);
    CREATE TABLE transactions AS
      WITH external_transfer_candidates AS (
        SELECT transfer_target_account_id AS external_account_id
        FROM source.transactions
        WHERE type = 'transfer' AND account_id IN (${accountIds})
          AND transfer_target_account_id IS NOT NULL
          AND transfer_target_account_id NOT IN (${accountIds})
        UNION
        SELECT account_id AS external_account_id
        FROM source.transactions
        WHERE type = 'transfer' AND account_id NOT IN (${accountIds})
          AND transfer_target_account_id IN (${accountIds})
      ),
      external_transfer_accounts AS (
        SELECT external_account_id,
               ROW_NUMBER() OVER (ORDER BY external_account_id) AS anonymized_id
        FROM external_transfer_candidates
      )
      SELECT source.transactions.id, NULL AS mf_id, date,
        CASE WHEN account_id IN (${accountIds}) THEN account_id END AS account_id,
        category, sub_category, description, amount, type, is_transfer,
        is_excluded_from_calculation,
        CASE WHEN transfer_target_account_id IN (${accountIds}) THEN transfer_target END
          AS transfer_target,
        CASE WHEN transfer_target_account_id IN (${accountIds}) THEN transfer_target_account_id END
          AS transfer_target_account_id,
        ${firstSeenAt},
        CASE
          WHEN type <> 'transfer' THEN NULL
          WHEN account_id IN (${accountIds}) AND transfer_target_account_id IN (${accountIds})
            THEN 'account:' || transfer_target_account_id
          WHEN external_transfer_accounts.anonymized_id IS NOT NULL
            THEN 'external:' || external_transfer_accounts.anonymized_id
          ELSE 'external:unknown'
        END AS transfer_counterparty_key,
        CASE WHEN type = 'transfer' AND EXISTS (
          SELECT 1 FROM source.group_accounts source_group
          JOIN source.group_accounts target_group
            ON target_group.group_id = source_group.group_id
          WHERE source_group.account_id = source.transactions.account_id
            AND target_group.account_id = source.transactions.transfer_target_account_id
            AND source_group.group_id <> '0'
        ) THEN 1 ELSE 0 END AS is_internal_transfer,
        source.transactions.created_at, source.transactions.updated_at
      FROM source.transactions
      LEFT JOIN external_transfer_accounts
        ON external_transfer_accounts.external_account_id = CASE
          WHEN source.transactions.account_id IN (${accountIds})
            THEN source.transactions.transfer_target_account_id
          ELSE source.transactions.account_id
        END
      WHERE (
        (type = 'transfer' AND (
          account_id IN (${accountIds}) OR transfer_target_account_id IN (${accountIds})
        )) OR (type <> 'transfer' AND account_id IN (${accountIds}))
      ) AND (
        type <> 'transfer' OR (account_id IS NOT NULL AND transfer_target_account_id IS NOT NULL)
      );
    CREATE TABLE asset_history AS
      SELECT * FROM source.asset_history WHERE id IN (${assetHistoryIds});
    CREATE TABLE asset_history_categories AS
      SELECT * FROM source.asset_history_categories
      WHERE asset_history_id IN (${assetHistoryIds});
    CREATE TABLE spending_targets AS
      SELECT * FROM source.spending_targets WHERE group_id = ${selectedGroup};
    CREATE INDEX group_accounts_group_id_idx ON group_accounts(group_id);
    CREATE INDEX holdings_account_id_idx ON holdings(account_id);
    CREATE INDEX holding_values_holding_id_idx ON holding_values(holding_id);
    CREATE INDEX transactions_account_id_idx ON transactions(account_id);
    CREATE INDEX transactions_date_idx ON transactions(date);
    COMMIT;
    DETACH DATABASE source;
    PRAGMA query_only = ON;
  `;
}

const QUERY_PROCESS_SOURCE = String.raw`
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try { run(JSON.parse(input)); }
    catch (error) { send({ error: error instanceof Error ? error.message : "Query failed." }); }
  });

  function send(message) { process.stdout.write(JSON.stringify(message) + "\n"); }
  function serialize(value) { return value instanceof Uint8Array ? Array.from(value) : value; }

  function run(data) {
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(":memory:", { allowExtension: false });
    try {
      database.exec("PRAGMA hard_heap_limit = " + data.maxHeapBytes);
      database.exec(data.setupSql);
      send({ ready: true });
      const statement = database.prepare(
        "SELECT * FROM (\n" + data.query + "\n) AS query_result LIMIT " + (data.maxRows + 1)
      );
      const columns = statement.columns().map((column) => column.name);
      if (columns.length > data.maxColumns) throw new Error("Too many result columns.");
      const rows = [];
      let bytes = 0;
      let truncated = false;
      const parameters = /:groupId\b/.test(data.query) ? { groupId: data.groupId } : {};
      for (const resultRow of statement.iterate(parameters)) {
        if (rows.length === data.maxRows) { truncated = true; break; }
        const row = Object.fromEntries(columns.map((column) => [column, serialize(resultRow[column])]));
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (bytes + rowBytes > data.maxBytes) { truncated = true; break; }
        rows.push(row);
        bytes += rowBytes;
      }
      send({ result: { columns, rows, rowCount: rows.length, truncated } });
    } finally { database.close(); }
  }
`;

interface QueryProcessMessage {
  error?: string;
  ready?: boolean;
  result?: QueryResult;
}

export async function runReadOnlyQuery(
  databasePath: string,
  sql: string,
  groupId: string,
  abortSignal?: AbortSignal,
): Promise<QueryResult> {
  abortSignal?.throwIfAborted();
  const query = normalizeReadOnlySql(sql);
  const setupSql = createScopedDatabaseSql(
    databasePath,
    groupId,
    transactionHasFirstSeenAt(databasePath),
  );
  const child = spawn(process.execPath, ["--eval", QUERY_PROCESS_SOURCE], {
    env: { NODE_ENV: "production", TZ: "Asia/Tokyo" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let message: QueryProcessMessage | undefined;
    let terminationReason: unknown;
    let timeout: ReturnType<typeof setTimeout>;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", abort);
      callback();
    };
    const terminate = (reason: unknown): void => {
      if (terminationReason) return;
      terminationReason = reason;
      clearTimeout(timeout);
      child.kill("SIGKILL");
    };
    const abort = (): void => {
      terminate(abortSignal?.reason ?? new Error("Query aborted."));
    };
    const armTimeout = (duration: number, error: string): void => {
      clearTimeout(timeout);
      timeout = setTimeout(() => terminate(new Error(error)), duration);
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      let lineEnd = stdout.indexOf("\n");
      while (lineEnd !== -1) {
        const line = stdout.slice(0, lineEnd);
        stdout = stdout.slice(lineEnd + 1);
        const next = JSON.parse(line) as QueryProcessMessage;
        if (next.ready) {
          armTimeout(QUERY_TIMEOUT_MS, "Query execution exceeded the time limit.");
        } else {
          message = next;
        }
        lineEnd = stdout.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() => {
        if (terminationReason) return reject(terminationReason);
        if (code !== 0) return reject(new Error(stderr.trim() || `Query process exited: ${code}`));
        if (message?.result) return resolve(message.result);
        reject(new Error(message?.error ?? "Invalid response from query process."));
      });
    });

    armTimeout(SETUP_TIMEOUT_MS, "Query sandbox setup exceeded the time limit.");
    abortSignal?.addEventListener("abort", abort, { once: true });
    if (abortSignal?.aborted) abort();
    else {
      child.stdin.end(
        JSON.stringify({
          groupId,
          maxBytes: QUERY_MAX_BYTES,
          maxColumns: MAX_COLUMNS,
          maxHeapBytes: MAX_SQLITE_HEAP_BYTES,
          maxRows: QUERY_MAX_ROWS,
          query,
          setupSql,
        }),
      );
    }
  });
}

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parseDatabasePath } from "./config.js";

describe("parseDatabasePath", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("accepts an existing absolute database path", () => {
    const directory = mkdtempSync(join(tmpdir(), "mf-dashboard-mcp-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "moneyforward.db");
    writeFileSync(databasePath, "");

    expect(parseDatabasePath(["--database", databasePath])).toBe(databasePath);
  });

  test.each([
    { args: [], message: "Usage" },
    { args: ["--database", "relative.db"], message: "absolute path" },
    { args: ["--database", "/missing/moneyforward.db"], message: "existing database" },
  ])("rejects invalid input: $message", ({ args, message }) => {
    expect(() => parseDatabasePath(args)).toThrow(message);
  });
});

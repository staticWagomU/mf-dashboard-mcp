import { describe, expect, test, vi } from "vitest";
import { registerFinanceTools, type FinanceDataAccess } from "./tools.js";

interface ToolResult {
  content: Array<{ text: string; type: "text" }>;
  structuredContent?: Record<string, unknown>;
}

type ToolHandler = (input: Record<string, unknown>) => Promise<ToolResult>;

function captureTools(dataAccess: FinanceDataAccess) {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _configuration: unknown, handler: ToolHandler) {
      handlers.set(name, handler);
    },
  };
  registerFinanceTools(server as never, dataAccess);
  return handlers;
}

describe("finance MCP tools", () => {
  test("registers exactly three read-only tools", () => {
    const handlers = captureTools({} as FinanceDataAccess);
    expect([...handlers.keys()]).toEqual([
      "list_finance_groups",
      "get_finance_schema",
      "query_finance",
    ]);
  });

  test("returns available groups", async () => {
    const dataAccess = {
      listGroups: vi.fn().mockResolvedValue([{ id: "personal", name: "Personal" }]),
    } as unknown as FinanceDataAccess;
    const result = await captureTools(dataAccess).get("list_finance_groups")!({});

    expect(result).toEqual({
      content: [{ type: "text", text: '{"groups":[{"id":"personal","name":"Personal"}]}' }],
      structuredContent: { groups: [{ id: "personal", name: "Personal" }] },
    });
  });

  test("returns schema guidance", async () => {
    const dataAccess = {
      describeSchema: vi.fn().mockReturnValue("schema guidance"),
    } as unknown as FinanceDataAccess;
    const result = await captureTools(dataAccess).get("get_finance_schema")!({});

    expect(result).toEqual({ content: [{ type: "text", text: "schema guidance" }] });
  });

  test("returns raw finance query results without raw IDs", async () => {
    const queryResult = {
      columns: ["description", "amount"],
      rowCount: 1,
      rows: [{ amount: 500, description: "Coffee" }],
      truncated: false,
    };
    const dataAccess = {
      query: vi.fn().mockResolvedValue(queryResult),
    } as unknown as FinanceDataAccess;
    const result = await captureTools(dataAccess).get("query_finance")!({
      groupId: "personal",
      sql: "SELECT description, amount FROM transactions",
    });

    expect(dataAccess.query).toHaveBeenCalledWith({
      groupId: "personal",
      sql: "SELECT description, amount FROM transactions",
    });
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(queryResult) }],
      structuredContent: queryResult,
    });
  });
});

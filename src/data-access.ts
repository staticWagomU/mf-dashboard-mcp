import { listFinanceGroups } from "./database.js";
import { runReadOnlyQuery } from "./query-sandbox.js";
import { SCHEMA_DESCRIPTION } from "./schema.js";
import type { FinanceDataAccess } from "./tools.js";

export function createFinanceDataAccess(databasePath: string): FinanceDataAccess {
  return {
    describeSchema() {
      return SCHEMA_DESCRIPTION;
    },
    async listGroups() {
      return listFinanceGroups(databasePath);
    },
    async query({ groupId, sql }) {
      const groups = listFinanceGroups(databasePath);
      if (!groups.some(({ id }) => id === groupId)) {
        throw new Error("Unknown finance group. Call list_finance_groups first.");
      }

      return runReadOnlyQuery(databasePath, sql, groupId);
    },
  };
}

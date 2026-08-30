export const EXPOSED_TABLES = [
  "account_statuses",
  "accounts",
  "asset_categories",
  "asset_history",
  "asset_history_categories",
  "daily_snapshots",
  "group_accounts",
  "groups",
  "holding_values",
  "holdings",
  "institution_categories",
  "spending_targets",
  "transactions",
] as const;

export const SCHEMA_DESCRIPTION = `Available group-scoped tables:
- groups(id, name, is_current, last_scraped_at, created_at, updated_at)
- group_accounts(id, group_id, account_id, created_at, updated_at)
- institution_categories(id, name, display_order, created_at, updated_at)
- accounts(id, mf_id, name, type, institution, category_id, created_at, updated_at, is_active)
- asset_categories(id, name, display_order, created_at, updated_at)
- account_statuses(id, account_id, status, message, created_at, updated_at)
- daily_snapshots(id, group_id, date, refresh_completed, created_at, updated_at)
- holdings(id, mf_id, account_id, category_id, name, code, type, liability_category, created_at, updated_at, is_active)
- holding_values(id, holding_id, snapshot_id, amount, quantity, unit_price, daily_change, unrealized_gain, created_at, updated_at)
- transactions(id, mf_id, date, account_id, category, sub_category, description, amount, type, is_transfer, is_excluded_from_calculation, transfer_target, transfer_target_account_id, first_seen_at, transfer_counterparty_key, is_internal_transfer, created_at, updated_at)
- asset_history(id, group_id, date, total_assets, created_at, updated_at)
- asset_history_categories(id, asset_history_id, category_name, amount, created_at, updated_at)
- spending_targets(id, group_id, category, amount, created_at, updated_at)

Semantics:
- Amounts are Japanese yen. transactions.amount is positive for both income and expense; use transactions.type.
- transactions.type is income, expense, or transfer. Do not infer it from the description or amount.
- Exclude ordinary transactions with is_excluded_from_calculation = 1 from income/expense totals.
- Exclude transactions with is_internal_transfer = 1 from income/expense totals.
- mf_id is always NULL in accounts, holdings, and transactions. Use id for counts and transfer_counterparty_key for transfer deduplication.
- first_seen_at is the UTC crawler observation time when supported by mf-dashboard. It is NULL for legacy rows and databases without that migration.
- Filter first_seen_at IS NOT NULL AND first_seen_at > :cutoff to find transactions first observed after a prior crawl.
- The selected group is available as the :groupId SQL parameter.
- Results are limited to 200 rows, 64 KiB, 32 columns, and one second of query execution.`;

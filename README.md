# mf-dashboard-mcp

[hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard) のローカルSQLiteデータを、MCP clientから安全に参照するためのread-only MCP serverです。

Money Forwardや1Passwordの認証情報を渡さず、明細・口座・保有資産などの家計生データだけをstdio経由で問い合わせられます。Hermes Agentで利用できますが、標準MCPに対応するclientであれば同じserverを利用できます。

## 特徴

- SQLite databaseをnetworkへ公開しないstdio transport
- 選択したmf-dashboard groupだけをin-memory databaseへ複製してquery
- 元databaseはSQLiteの`mode=ro`でattach
- `INSERT`、`UPDATE`、`DELETE`、`ATTACH`、`PRAGMA`などを拒否
- Money Forward由来の`mf_id`を常に`NULL`へ匿名化
- 最大200行、64 KiB、32列、SQL 5,000文字、実行1秒の制限
- query processへMoney Forward、1Password、Cloudflareなどの環境変数を継承しない
- `transactions.first_seen_at`の有無を自動判定し、未対応databaseでは`NULL`として公開

## 必要環境

- LinuxまたはmacOS
- Node.js 22.13.0以上
- pnpm 11.24.0以上
- setup済みの[hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard)
- mf-dashboardが生成した`data/moneyforward.db`

`node:sqlite`を利用するため、Node.js 22.13.0未満では動作しません。

## Install

`ghq`でcloneしてbuildします。

```sh
ghq get https://github.com/staticWagomU/mf-dashboard-mcp.git
cd "$(ghq root)/github.com/staticWagomU/mf-dashboard-mcp"
pnpm install --frozen-lockfile
pnpm build
```

## Hermes Agentへ登録

次の例では、MCP processを空の環境変数から起動します。`MF_DASHBOARD_DB`は自分のmf-dashboard databaseの絶対pathへ変更してください。

```sh
MF_DASHBOARD_MCP_ROOT="$(ghq root)/github.com/staticWagomU/mf-dashboard-mcp"
MF_DASHBOARD_DB="$(ghq root)/github.com/hiroppy/mf-dashboard/data/moneyforward.db"
MF_DASHBOARD_NODE="$(command -v node)"
MF_DASHBOARD_NODE_PATH="$(dirname "$MF_DASHBOARD_NODE"):/usr/bin:/bin"

hermes mcp add mf-dashboard \
  --command /usr/bin/env \
  --args \
  -i \
  "PATH=$MF_DASHBOARD_NODE_PATH" \
  NODE_ENV=production \
  TZ=Asia/Tokyo \
  "$MF_DASHBOARD_NODE" \
  "$MF_DASHBOARD_MCP_ROOT/dist/index.js" \
  --database \
  "$MF_DASHBOARD_DB"
```

接続を確認します。

```sh
hermes mcp test mf-dashboard
```

toolが3つ表示されれば接続完了です。

## 他のMCP clientへ登録

clientの設定形式に合わせて、次と同等のstdio commandを登録してください。

```json
{
  "mcpServers": {
    "mf-dashboard": {
      "command": "/usr/bin/env",
      "args": [
        "-i",
        "PATH=/absolute/path/to/node/bin:/usr/bin:/bin",
        "NODE_ENV=production",
        "TZ=Asia/Tokyo",
        "/absolute/path/to/node",
        "/absolute/path/to/mf-dashboard-mcp/dist/index.js",
        "--database",
        "/absolute/path/to/mf-dashboard/data/moneyforward.db"
      ]
    }
  }
}
```

## Tools

| Tool                  | 内容                                                     |
| --------------------- | -------------------------------------------------------- |
| `list_finance_groups` | 参照可能なgroupのIDと名前を返す                          |
| `get_finance_schema`  | query可能なtable、column、家計集計規則を返す             |
| `query_finance`       | 指定groupに限定したread-only SQLを実行し、生データを返す |

Hermesには次のように依頼できます。

```text
mf-dashboard MCPを使って、今月の支出をカテゴリ別に集計して。
最初にlist_finance_groupsとget_finance_schemaを確認してからquery_financeを使って。
```

### 新しく届いた明細を調べる

`first_seen_at`対応済みのmf-dashboard databaseでは、前回crawler取得時刻より後に初めて観測された明細を抽出できます。

```sql
SELECT date, description, amount, category, first_seen_at
FROM transactions
WHERE first_seen_at IS NOT NULL
  AND first_seen_at > '2026-08-30T21:30:00.000Z'
ORDER BY first_seen_at DESC;
```

`first_seen_at` migration前から存在する明細と、未対応のmf-dashboard databaseでは`first_seen_at`が`NULL`になります。過去の初回取得時刻を後から復元することはできません。

## Security

このserverは認証情報をMCP toolとして公開せず、query対象をgroup-scoped in-memory databaseへ限定します。元databaseもSQLite read-only URIで開きます。

一方、明細の摘要、口座名、金額などは意図的に生データとして返します。MCP clientが利用するmodel providerへ送信され得るため、providerのデータ取扱方針を確認してください。詳細と脆弱性の報告方法は[SECURITY.md](SECURITY.md)を参照してください。

## Development

```sh
pnpm install
pnpm check
pnpm build
```

testは一時SQLite databaseだけを利用し、実際のMoney Forwardデータを必要としません。

## License and attribution

MIT Licenseです。query sandboxとmf-dashboard schemaの取り扱いは、MIT Licenseで公開されている[hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard)の実装を基にしています。原著作権表示は[LICENSE](LICENSE)と[NOTICE](NOTICE)に記載しています。

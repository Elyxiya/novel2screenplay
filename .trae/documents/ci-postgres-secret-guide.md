# CI 配置 DATABASE_URL Secret 操作文档

> 目标：把 R6 已经本地验证过的 PostgreSQL 双后端测试固化进 CI，让 `ci.yml` 的 test job 真正启用 postgres 分支。
>
> 关联：[pg-multitenant-quality-report.md](./pg-multitenant-quality-report.md) · 决策 B（本阶段不搭生产 PG，R6 配好环境后自动启用）。

## 1. 现状

`ci.yml` 的 `test` job 已经声明了一个可用的 `postgres:16` service，但 **默认只在没有 `DATABASE_URL` 时以 SQLite 单跑**：

```yaml
services:
  postgres:
    image: postgres:16
    env:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: novel2screenplay_test
    ports:
      - 5432:5432
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}   # ← 未配置 secret 即为空，PG 分支静默跳过
```

测试侧（`helpers/dual-backend.ts`）的行为是：

- `DATABASE_URL` 存在 → `activeBackends()` 返回 `['sqlite','postgres']`，repository-contract 14 例 / schema-parity 等双跑。
- `DATABASE_URL` 为空 → 仅跑 SQLite（本地无 PG 时的回归兜底，静默跳过，不报错）。

所以只要在仓库 Secrets 里填上正确的 `DATABASE_URL`，CI 就会自动多跑 PostgreSQL 分支，**无需改任何代码**。

## 2. 关键约束（务必先读）

`helpers/dual-backend.ts` 的 `resolveTestPgUrl` 会把连接串里的**库名追加 `_test` 后缀**（除非显式设置 `PG_TEST_DATABASE`）：

```ts
// mydb → mydb_test
u.pathname = `/${seg.join('/')}_test`;
```

而 CI 的 postgres service 初始化的库名恰好是 `novel2screenplay_test`（`POSTGRES_DB`）。

因此 **secret 的 DATABASE_URL 必须写基础库名 `novel2screenplay`**，让 `resolveTestPgUrl` 派生出的 `novel2screenplay_test` 与 service 准备好的库一致。若把 secret 写成 `.../novel2screenplay_test`，会被再次后缀变成 `novel2screenplay_test_test`，连不上而报错。

## 3. 推荐的 Secret 值

| 项 | 值 |
|---|---|
| Secret 名 | `DATABASE_URL` |
| 值 | `postgres://test:test@localhost:5432/novel2screenplay` |
| 派生测试库 | `postgres://test:test@localhost:5432/novel2screenplay_test` ✔ 命中 service |
| 用户 / 密码 | `test` / `test`（对齐 service 的 POSTGRES_USER / POSTGRES_PASSWORD） |
| host | `localhost`（service 端口 5432 映射到宿主，test job 与 service 同机直连） |

## 4. 操作步骤（GitHub UI）

1. 打开仓库 → **Settings** → **Secrets and variables → Actions**。
2. 点击 **New repository secret**。
3. Name 填 `DATABASE_URL`，Secret 填：

   ```
   postgres://test:test@localhost:5432/novel2screenplay
   ```

4. 保存后，任何 `main` 分支 push 或 PR，CI 的 test job 即会带 `DATABASE_URL` 运行，`[postgres]` 分支真实执行。

> 提示：Secret 对 `pull_request` 事件默认也可用（fork 的外部 PR 需仓库属主显式允许 secrets）。若你的协作流程用 fork PR，可在 **Settings → Actions → General** 打开「Enable workflows on pull requests from forks with … accessible to pull requests from fork PRs」；否则普通分支/内部 PR 无需任何额外配置。

## 5. 验证（第一次配置后）

1. 触发一次 CI（push 或 close + reopen PR）。
2. 看 **Unit Tests** job 日志，确认出现：
   - `repository-contract.test.ts [postgres] ...` 之类的 `[postgres]` 分组（schema-parity / repository-contract / dual-backend 均带该后缀）。
   - PG health check 通过、`applySchema` 正常执行。
3. 若日志里全是 `[sqlite]` 而无 `[postgres]`，说明 `DATABASE_URL` 未注入或值不正确——回到第 3 节核对格式。

## 6. 附：不使用 GitHub 时

- **本地重放校验**：配 `DATABASE_URL=postgres://novel:novel@localhost:5433/novel2screenplay`（对应本机 Docker PG `n2s-pg`）跑 `npm test`，与 R6a 相同，全绿即代表 CI 分支行为一致。
- **若暂不想开 CI PG**：什么都不做即可——`DATABASE_URL` 为空时 CI 维持 SQLite 单跑，`lint / typecheck / test / build` 四个 job 照常绿灯，不影响合入门槛。

## 归档说明

Secret 值（`test/test` 加基础库名）是 CI 专用测试连接串，不含任何生产凭据，可安全入库文档；实际操作只需在仓库面板填一次。
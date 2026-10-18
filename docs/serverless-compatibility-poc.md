## 目的与判定

本 PoC 只检查 Worker 请求/流边界、D1 基础能力和 Executor 依赖隔离方向。它不代表完整 9router 请求链路已迁移，也不修改 `open-sse` 生产实现。

判定：`CONDITIONAL`。Worker fetch/stream 骨架可构建并通过本地测试；本地 D1 可异步写入并读取；隔离 Worker bundle 不导入现有全量 Executor registry。完整 `open-sse` translator/provider 链路、生产 Executor capability registry、同步持久层迁移及可用于 Free CPU 档结论的 CPU 证据仍未完成。

## 证据与来源

- Base：`serverless-architecture`，`87a74e1bda3677193c6f71a7e2100c90311f0689`。
- LANE-A：`poc/phase0-worker-core`，`6f39530a61db41ebf4c231525103ce3851ab7713`。
- LANE-B：`poc/phase0-d1-executor`，`8adddde2bfbf28a524b27bc88b69a2f54d03291e`。
- 集成分支：`poc/serverless-phase0`。本文件记录集成验证；集成 PR 未合并。
- Worker 源码在 `cloud-poc/src/worker.js`；mock upstream 在 `cloud-poc/mock-upstream.mjs`；D1 migration 在 `cloud-poc/migrations/0001_probe.sql`。

## Worker 可复用部分

- Worker `fetch` handler 使用标准 `Request`、`Response`、`fetch` 与 `ReadableStream` 边界。
- Worker 将 JSON 请求、SSE 多 chunk、上游非 2xx 响应与请求 abort 传递到 mock upstream，不缓存整个 SSE 响应。
- `cloud-poc/src/worker-executors.js` 是独立的 Worker allow-list，不 import `open-sse/executors/index.js`。
- 验证命令：在 `cloud-poc/` 执行 `npm test`、`npm run build`。集成结果：6/6 tests pass；Wrangler dry-run pass，bundle 2.54 KiB（gzip 1.05 KiB），识别 `DB` 与 `UPSTREAM_ORIGIN` bindings。

## 需 Adapter 的部分

- Worker 上游请求需配置可访问的 upstream URL、认证、超时和错误策略；本 PoC 只使用无密钥 mock。
- D1 API 为异步 API。现有同步 SQLite adapter 的调用约定不能直接调用 D1；需要单独设计 async repository/service 边界与调用链迁移。本 PoC 不改同步 adapter。
- Worker allow-list 只证明隔离边界，不是生产 provider 注册表。生产入口仍需按 runtime capability 选择 executor，并在不兼容时拒绝注册或延迟加载。

## Local-only 与静态依赖证据

当前 `open-sse/executors/index.js` 静态 import 多个 executor 类并在模块顶层构造 registry。依赖图中可直接观察到：

```text
open-sse/executors/index.js
  -> cursor.js
       -> 条件式动态 import("http2")；Cursor AgentService 路径要求 Node HTTP/2
  -> devin-cli.js
       -> node:child_process, node:path, node:os, node:fs, node:readline
  -> ollama-local.js
       -> host-local Ollama endpoint
  -> windsurf.js
       -> node:crypto
```

因此，Worker 入口若直接 import 该全量 registry，会让 Node/Local 专用依赖进入 bundler 的静态可达图；Cursor 的 HTTP/2 载入虽是条件式动态 import，Cursor executor 本身仍由 registry 静态引用。集成 Worker 只 import `cloud-poc/src/worker-executors.js`；Wrangler dry-run 成功且产物为 2.54 KiB / 1.05 KiB gzip。该结果证明隔离入口可以独立打包，不声称全量 registry 已成功打包或生产代码已隔离。

## D1 结论

`cloud-poc/wrangler.toml` 的 `DB` binding 与 `0001_probe.sql` 的单表 migration 构成本 PoC 的 D1 最小配置。Worker `POST /probe/d1` 执行异步 `INSERT OR REPLACE` 后再 `SELECT`。集成验证执行：

```sh
npx wrangler d1 execute lane-b --local --file=migrations/0001_probe.sql
npx wrangler d1 execute lane-b --local --command "INSERT OR REPLACE INTO probe_records (key, value) VALUES ('integration-proof', 'd1-roundtrip-ok')"
npx wrangler d1 execute lane-b --local --command "SELECT key, value FROM probe_records WHERE key = 'integration-proof'"
```

本地 SELECT 返回 `integration-proof | d1-roundtrip-ok`。这证明本地 D1 binding/storage 可完成一个真实 write/read；不证明远端 D1、并发、事务语义、迁移流程或同步 adapter 兼容。

## Streaming 结论

`npm test` 保留 LANE-A 的 4 项覆盖，并增加 2 项 D1/registry 覆盖：JSON 200、SSE 多 chunk、429 原样透传、client abort 关闭 upstream、D1 异步写读路由、Local-only provider 被 Worker allow-list 拒绝。结果为 6/6 pass。LANE-A 的本地 `wrangler dev` smoke（JSON、SSE、429、abort）在其交付时通过；集成后重新运行全部 Node 测试、Wrangler dry-run 和 D1 本地写读。此结论限于 HTTP/stream 边界，不覆盖完整 `open-sse` translator 或真实 provider executor。

## CPU 证据

测量方法：本地 `wrangler dev` / Miniflare Worker observability。清空本地 observability 记录后，依序发出 10 个 JSON 请求，再发出 10 个 SSE 请求；通过 Local Explorer 的只读 SQL 查询读取每个根 invocation span 的 `cpu_time_ms`。JSON 样本是前 10 次，SSE 样本是后 10 次；20 次请求均返回 HTTP 200。

可复现实验：在 `cloud-poc/` 分别启动 `npm run mock` 与 `npm run dev -- --ip 127.0.0.1 --port 8787`。清空 Explorer observability 后，在 shell 连续执行：

```sh
for i in $(seq 1 10); do curl -sS -o /dev/null -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"prompt":"cpu-sample"}'; done
for i in $(seq 1 10); do curl -sS -o /dev/null -X POST http://127.0.0.1:8787/v1/chat/completions -H 'content-type: application/json' -d '{"stream":true}'; done
```

在 `POST /cdn-cgi/local/explorer/api/local/observability/query` 执行只读 SQL：

```sql
SELECT start_ms,
       json_extract(json(attributes), '$.cpu_time_ms') AS cpu_time_ms,
       duration_ms
FROM spans
WHERE parent_id IS NULL AND name = 'POST'
ORDER BY start_ms;
```

结果：JSON `N=10`，`cpu_time_ms` 范围 `0–0 ms`；SSE `N=10`，`cpu_time_ms` 范围 `0–0 ms`。Local Explorer span 的 CPU 指标以整数毫秒呈现；观察到的 0 ms 只能说明该本地计量没有报告满 1 ms 的 CPU 使用，不能区分实际使用为 0 或小于其分辨率。Wrangler 请求日志中的毫秒时长是 wall time，不作为 CPU 数值。

判断：`EVIDENCE_INSUFFICIENT`。不能用本地量化分辨率和本机 workerd 运行时外推 Cloudflare Free 10 ms 档，也没有远端 Cloudflare CPU 样本。需 Cloudflare 凭据及远端重复采样，并记录远端 invocation CPU 指标，才能判断「明显可行 / 明显危险 / 证据不足」。本 PoC 选择「证据不足」，不以感觉推断风险。

## 下一阶段边界与 blockers

1. 为 provider registry 定义 Worker/Node capability contract，并用 bundle 检查确保 Local-only executor 不进入 Worker bundle；不在此阶段重写每个 executor。
2. 单独设计异步 persistence interface，评估 D1 transaction/consistency/migration 语义；不伪装同步 adapter 兼容。
3. 在 Worker 中接入 runtime-neutral `open-sse` translator 的最小真实链路，并保留 mock JSON/SSE/error/abort 测试。
4. 取得 Cloudflare 人类凭据后，执行代表性 JSON 与 SSE 请求的远端 CPU 采样；当前为外部 blocker。
5. 部署可达的 upstream 并定义认证、timeout、限流与取消策略；当前 mock 不验证这些生产策略。

SERVERLESS_POC_CONDITIONAL

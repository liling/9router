## 目的与判定

本 PoC 检查 Worker 请求/流边界、D1 基础能力、生产 response translator 的 Worker 可运行性及 Executor 依赖隔离方向。它不代表完整 9router 请求链路已迁移；`open-sse` 改动仅限 translator 注册入口拆分和一处死 import / Node builtin 加载修正。

判定：`SERVERLESS_POC_CONDITIONAL`。Worker dry-run、`wrangler dev` workerd 启动及 cloud-poc 的 7 项测试通过。JSON 与 SSE 路径均实际调用 `open-sse/translator/index.js` 的 `translateResponse`，分别覆盖 OpenAI→Claude 与 Claude→OpenAI；本地 D1 可异步写入并读取。生产 Executor 未进入 Phase 0 PoC，request translator 没有已注册 pair；完整 Local 测试在本次分支和干净 base 上以相同方式失败，详见基线对照。同步持久层迁移及 Cloudflare 远端 CPU 证据仍未完成。

## Objective #1：生产核心路径结论

结论：`CONDITIONAL`。Worker dry-run 构建成功，`wrangler dev` 在 workerd 启动并完成 JSON 与 SSE 本地请求；两条响应均走生产 `translateResponse`。此前 bundled 顶层 `setInterval` 的 `Disallowed operation called within global scope` 已由 `sessionManager.js` 将两处 TTL timer 改为各自 store 首次写入时 lazy-init 处理。Node smoke 确认首次 runtime-store 写入和首次 assistant/continuation-store 写入分别创建并 `unref` 清理 timer；调用模块本身不创建 timer。`translateRequest` 本体可 import，但 PoC 未注册 request pair；完整 request registry 仍受 `concerns/image.js` 的 `undici` / `node:dns` 依赖阻挡。生产 Executor 未接入 PoC，不能据此宣称完整 Router Core 已运行于 Worker。

## 证据与来源

- Base：`serverless-architecture`，`87a74e1bda3677193c6f71a7e2100c90311f0689`。
- LANE-A：`poc/phase0-worker-core`，`6f39530a61db41ebf4c231525103ce3851ab7713`。
- LANE-B：`poc/phase0-d1-executor`，`8adddde2bfbf28a524b27bc88b69a2f54d03291e`。
- 集成分支：`poc/serverless-phase0`。本文件记录集成验证；集成 PR 未合并。
- Worker 源码在 `cloud-poc/src/worker.js`；mock upstream 在 `cloud-poc/mock-upstream.mjs`；D1 migration 在 `cloud-poc/migrations/0001_probe.sql`。

## Worker 可复用部分

- Worker `fetch` handler 使用标准 `Request`、`Response`、`fetch` 与 `ReadableStream` 边界；生产 response translation 使用现有 registry / `translateResponse`，未在 `cloud-poc` 复制 translator。
- Worker 将 JSON 请求、SSE 多 chunk、上游非 2xx 响应与请求 abort 传递到 mock upstream；JSON OpenAI→Claude 与 SSE Claude→OpenAI 都在 mock upstream 响应后调用生产 response translator，不缓存整个 SSE 响应。
- `cloud-poc/src/worker-executors.js` 保留为独立 capability allow-list，不 import `open-sse/executors/index.js`；Worker 请求实际使用标准 `fetch`，不声称生产 Executor 已接入。
- 验证命令：在 `cloud-poc/` 执行 `npm test`、`npx wrangler deploy --dry-run`。当前结果：7 tests pass（原有 6 项加 1 项 translator registry parity）；Wrangler dry-run pass，bundle 307.58 KiB（gzip 65.86 KiB），识别 `DB` 与 `UPSTREAM_ORIGIN` bindings。

## 需 Adapter 的部分

- Worker 上游请求需配置可访问的 upstream URL、认证、超时和错误策略；本 PoC 只使用无密钥 mock。
- D1 API 为异步 API。现有同步 SQLite adapter 的调用约定不能直接调用 D1；需要单独设计 async repository/service 边界与调用链迁移。本 PoC 不改同步 adapter。
- `translateRequest` 可从生产入口 import，但 Worker 当前只注册 response translator，故没有已注册 request pair 可调用；注册完整 request 集仍会引入 `concerns/image.js` 的 `undici` 与 `node:dns`。
- Worker allow-list 只证明隔离边界，不是生产 provider 注册表。生产 executor 未进 Phase 0 PoC，根因见下表；Phase 1 边界为按 C2 方向提取 runtime-neutral 子集，不在本 PR 重构 executor。

## Local-only 与静态依赖证据

当前 `open-sse/executors/index.js` 静态 import 多个 executor 类并在模块顶层构造 registry。生产 executor 整体未进 Phase 0 PoC；下表为 blocker 根因及边界：

| 根因 | 证据 / Worker 影响 |
| --- | --- |
| 全量 eager registry | `executors/index.js` 静态 import 并实例化 30+ executor，包含 `uuid`、AWS credential provider、`node-machine-id`、`open`、`chalk`、`ora`、`child_process` 等 Local / Node 依赖。 |
| Default / Base 静态依赖 | `default.js` / `base.js` 链含 `proxyFetch` 的 Node `stream`（`Readable.toWeb` 尚未在本 PoC 的生产 executor 路径验证）、OAuth credential/token refresh 依赖，以及 `appConstants` 原有 `createRequire` Node 加载路径。`appConstants` 已将 `createRequire` 改为调用时的 Node builtin lookup，Node Kimi header smoke 通过；这不等于 DefaultExecutor 在 Worker 已可运行。 |
| Antigravity 的越包依赖 | `translator/index.js` 原有未使用的 Antigravity import 会引入 `thoughtSignatureStore`，其顶层 `makeKv()` 解析到仓库 `src/lib/db`。本轮移除该死 import；若引入 Antigravity executor，该依赖仍然存在。 |
| Provider service | `services/provider.js` 在本次归因中不是越包依赖来源；不得将该模块列为 blocker 或在 Phase 0 改动。 |

Phase 1 建议从 C2 式 runtime-neutral executor 子集中提取可部署能力，再逐步适配 persistence、OAuth 和 stream transport；当前不拆全量 registry、不改 executor 实现。

Worker 的响应 translator 依赖边界：

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

因此，Worker 入口没有 import 全量 registry；Wrangler dry-run 成功且产物为 307.58 KiB / 65.86 KiB gzip。此结果证明所选 response-translator 依赖图可构建，不证明生产 Executor 或全量 request translator registry 可打包。

## D1 结论

`cloud-poc/wrangler.toml` 的 `DB` binding 与 `0001_probe.sql` 的单表 migration 构成本 PoC 的 D1 最小配置。Worker `POST /probe/d1` 执行异步 `INSERT OR REPLACE` 后再 `SELECT`。集成验证执行：

```sh
npx wrangler d1 execute lane-b --local --file=migrations/0001_probe.sql
npx wrangler d1 execute lane-b --local --command "INSERT OR REPLACE INTO probe_records (key, value) VALUES ('integration-proof', 'd1-roundtrip-ok')"
npx wrangler d1 execute lane-b --local --command "SELECT key, value FROM probe_records WHERE key = 'integration-proof'"
```

本地 SELECT 返回 `integration-proof | d1-roundtrip-ok`。这证明本地 D1 binding/storage 可完成一个真实 write/read；不证明远端 D1、并发、事务语义、迁移流程或同步 adapter 兼容。

## Streaming 结论

`npm test` 保留 6 项既有覆盖：JSON→Claude 生产 response translator、Claude→OpenAI 多事件 SSE 生产 response translator、429 原样透传、client abort upstream、D1 异步写读、Local-only provider 拒绝；另加 1 项 registry parity 检查。当前结果 7/7 pass。翻译代码调用仓库 `translateResponse`，不在 Worker 旁路复制。此结论不覆盖生产 executor 或完整 request translator。

## sessionManager timer 兼容性与 Local 基线

`open-sse/utils/sessionManager.js` 的 runtime-session 清理 interval 仅在首次 `runtimeSessionStore` 写入后创建；assistant/continuation 清理 interval 仅在相应 store 首次写入后创建。两个 interval 保留 Node `.unref()` 守卫，回调、TTL、cleanup 周期、容量上限与淘汰逻辑不变。Node smoke 观察到模块 import 后 interval 数为 0；`deriveSessionId(connectionId)` 首次写入后新增一个 unref timer；首次 assistant session 写入后新增第二个 unref timer。workerd 不再在 Worker 全局求值时触发 `setInterval`。

Local 全量对照使用同一 Node/npm 环境、同一命令 `cd tests && npx vitest run --reporter=dot`，head 与干净 base `87a74e1bda3677193c6f71a7e2100c90311f0689` 均失败。两侧均观察到以下相同诊断：

```text
No test suite found: tests/auth/saml.test.js
No test suite found: tests/unit/cline-auth.test.js
Cannot find package 'lowdb' imported from tests/unit/db-benchmark.test.js
Cannot find module '/cloud/src/handlers/embeddings.js' imported from tests/unit/embeddings.cloud.test.js
unit/kimchi.test.js: expected 'oauth', actual 'freeTier'
```

结论是「基线已失败，非本 PR 回归」，不是 Local 全量测试通过；本 PR 不修复 suite discovery、缺失 `lowdb` 或上述既有测试错误。逐侧运行命令及以上相同错误输出即为对照证据。

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

## Local Bun profile（实测）

在 Bun 1.4.2 与 Node v24.21.0 下，`buildKimiHeaders()["X-Msh-Version"]` 均返回 package.json 的真实版本 `0.5.104`，不是 `0.0.0`。Bun 下显式导入 `translator/register-all.js` 后，Core `translateRequest` 的 OpenAI→Claude smoke 通过。另有测试覆盖 `process.getBuiltinModule` 不可用时以 `npm_package_version` 解析版本的 fallback。当前证据支持 Bun 与 Node 的 Local profile；不代表 Worker profile 或所有 Bun 部署方式均已验证。

1. 按 C2 式边界提取 runtime-neutral executor 子集，明确定义 Worker/Node capability contract，并用 bundle 检查确保 Local-only executor 不进入 Worker bundle；不重写每个 executor。
2. 单独设计异步 persistence interface，评估 D1 transaction/consistency/migration 语义；不伪装同步 adapter 兼容。
3. 增量评估 request translator registry 与 image concerns 的 Worker 兼容性；当前已运行的 response translator 双向路径继续保留测试。
4. 取得 Cloudflare 人类凭据后，执行代表性 JSON 与 SSE 请求的远端 CPU 采样；当前为外部 blocker。
5. 部署可达的 upstream 并定义认证、timeout、限流与取消策略；当前 mock 不验证这些生产策略。

SERVERLESS_POC_CONDITIONAL

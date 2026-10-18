# Lane B: D1 and executor boundary probe

This directory is intentionally self-contained until Lane A's shared Wrangler
configuration is available. Do not merge either lane as part of this probe.

## D1 probe

`migrations/0001_probe.sql` creates one tiny table. The Worker performs an
async D1 insert and select at `/probe/d1` (POST JSON `{ "key", "value" }`).
This validates D1 binding and async I/O only; it does not adapt the existing
synchronous SQLite adapter, whose call contract cannot be preserved by D1's
promise-based API without an architectural change.

## Executor import finding

`open-sse/executors/index.js` statically imports and constructs the complete
specialized registry. In particular, it imports Cursor and Devin CLI, so a
consumer importing that entry also exposes Node HTTP/2 and `node:child_process`,
filesystem, OS, and readline dependencies to its bundler. Cursor's HTTP/2 import
is dynamic, but the executor itself remains statically reachable; Devin CLI
uses static Node built-ins. Ollama is host-local rather than Worker-compatible.

The small registry in `src/worker-executors.js` demonstrates the isolation
boundary: only Worker-safe provider identifiers enter it, and it contains no
imports from the all-provider registry. The Wrangler dry-run bundle is the
artifact-level check that this Worker entry avoids those modules. This is a
proof of the boundary pattern, not a replacement for converting the production
registry; a production integration still needs an explicit capability-aware
registry or lazy-loading contract.

## Reproduce

From this directory:

```sh
npm install
npx wrangler deploy --dry-run
npx wrangler d1 execute lane-b --local --file=migrations/0001_probe.sql
npx wrangler d1 execute lane-b --local --command "INSERT OR REPLACE INTO probe_records (key, value) VALUES ('lane-b-proof', 'write-read-ok')"
npx wrangler d1 execute lane-b --local --command "SELECT key, value FROM probe_records WHERE key = 'lane-b-proof'"
npm test
```

The deployment/binding remains local; no Cloudflare credentials or remote D1
access are required. Lane A should supply the eventual shared `cloud-poc/`
Wrangler scaffold; this standalone subdirectory can then be folded into it.

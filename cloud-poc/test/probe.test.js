import assert from "node:assert/strict";
import { test } from "node:test";
import { getExecutor, RuntimeCapabilityError } from "../../open-sse/executors/serverless.js";
import worker from "../src/worker.js";

test("production serverless registry excludes Local-only executors", () => {
  assert.equal(getExecutor("openai").constructor.name, "DefaultExecutor");
  assert.throws(() => getExecutor("devin-cli"), RuntimeCapabilityError);
});

test("D1 probe asynchronously writes and reads through its binding", async () => {
  const statements = [];
  const rows = new Map();
  const env = {
    DB: {
      prepare(sql) {
        const statement = { sql, values: [] };
        statements.push(statement);
        return {
          bind(...values) {
            statement.values = values;
            return this;
          },
          async run() {
            rows.set(statement.values[0], statement.values[1]);
            return { success: true };
          },
          async first() {
            const [key] = statement.values;
            return rows.has(key) ? { key, value: rows.get(key) } : null;
          },
        };
      },
    },
  };
  const response = await worker.fetch(
    new Request("http://worker.test/probe/d1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "test-key", value: "test-value" }),
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    row: { key: "test-key", value: "test-value" },
    executor: "openai",
  });
  assert.match(statements[0].sql, /^INSERT/);
  assert.match(statements[1].sql, /^SELECT/);
});

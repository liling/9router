import test from "node:test";
import assert from "node:assert/strict";
import { getWorkerExecutor, excludedLocalProviders } from "../src/worker-executors.js";

test("worker registry admits fetch-compatible entries only", () => {
  assert.deepEqual(getWorkerExecutor("openai"), { kind: "fetch", provider: "openai" });
  for (const provider of excludedLocalProviders) {
    assert.throws(() => getWorkerExecutor(provider), /not registered for Workers/);
  }
});

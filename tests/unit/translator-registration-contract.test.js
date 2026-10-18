import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const translatorRoot = new URL("../../open-sse/translator/", import.meta.url);
const moduleScript = (source) => execFileSync(process.execPath, ["--input-type=module", "-e", source], { cwd: root, encoding: "utf8" });

async function registeredPairs(entry) {
  const source = await readFile(new URL(entry, translatorRoot), "utf8");
  const files = [...source.matchAll(/^import "\.\/([^"]+)";/gm)].map((match) => match[1]);
  const pairs = [];
  for (const file of files) {
    const text = await readFile(new URL(file, translatorRoot), "utf8");
    for (const [, from, to] of text.matchAll(/register\(FORMATS\.(\w+),\s*FORMATS\.(\w+)/g)) pairs.push(`${from}:${to}`);
  }
  return pairs;
}

async function reachableFrom(entry) {
  const seen = new Set();
  const pending = [new URL(entry, translatorRoot)];
  while (pending.length) {
    const url = pending.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const source = await readFile(url, "utf8");
    for (const [, specifier] of source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g)) {
      if (specifier.startsWith(".")) pending.push(new URL(specifier, url));
      else if (/^(node:|undici$)/.test(specifier)) seen.add(specifier);
    }
  }
  return [...seen];
}

describe("translator registration contract", () => {
  it("keeps importing the translator core registry-neutral", () => {
    moduleScript(`
      const core = await import('./open-sse/translator/index.js');
      const chunk = { type: 'message_start', message: { id: 'm1', model: 'claude-sonnet', content: [] } };
      for (const invoke of [
        () => core.translateRequest('openai', 'claude', 'claude-sonnet', { messages: [] }),
        () => core.translateResponse('claude', 'openai', chunk, core.initState('openai')),
      ]) {
        try { invoke(); throw new Error('core import unexpectedly registered translators'); }
        catch (error) { if (error.message === 'core import unexpectedly registered translators') throw error; }
      }
    `);
  });

  it("preserves the local full registration order", async () => {
    assert.deepEqual(await registeredPairs("register-all.js"), [
      "CLAUDE:OPENAI", "OPENAI:CLAUDE", "GEMINI:OPENAI", "GEMINI_CLI:OPENAI", "OPENAI:GEMINI",
      "OPENAI:GEMINI_CLI", "OPENAI:ANTIGRAVITY", "OPENAI:VERTEX", "ANTIGRAVITY:OPENAI",
      "OPENAI_RESPONSES:OPENAI", "OPENAI:OPENAI_RESPONSES", "OPENAI:KIRO", "OPENAI:CURSOR",
      "OPENAI:OLLAMA", "OPENAI:COMMANDCODE", "CLAUDE:KIRO", "CLAUDE:OPENAI", "OPENAI:CLAUDE",
      "GEMINI:OPENAI", "GEMINI_CLI:OPENAI", "ANTIGRAVITY:OPENAI", "VERTEX:OPENAI", "OPENAI:ANTIGRAVITY",
      "OPENAI:OPENAI_RESPONSES", "OPENAI_RESPONSES:OPENAI", "KIRO:OPENAI", "CURSOR:OPENAI", "OLLAMA:OPENAI",
      "COMMANDCODE:OPENAI", "KIRO:CLAUDE",
    ]);
    await import("../../open-sse/translator/register-all.js");
    const core = await import("../../open-sse/translator/index.js");
    const request = core.translateRequest("openai", "claude", "claude-sonnet", { messages: [{ role: "user", content: "hello" }] });
    const chunk = { type: "message_start", message: { id: "m1", model: "claude-sonnet", content: [] } };
    const response = core.translateResponse("claude", "openai", chunk, core.initState("openai"));
    assert.ok(request.messages?.length && request.max_tokens);
    assert.notEqual(response[0], chunk);
    assert.ok(response[0]?.choices);
  });

  it("registers exactly the four approved serverless pairs", async () => {
    assert.deepEqual(await registeredPairs("register-serverless.js"), [
      "CLAUDE:OPENAI", "OPENAI:CLAUDE", "OPENAI:CLAUDE", "CLAUDE:OPENAI",
    ]);
    moduleScript(`
      await import('./open-sse/translator/register-serverless.js');
      const core = await import('./open-sse/translator/index.js');
      const result = core.translateRequest('openai', 'claude', 'claude-sonnet', { messages: [{ role: 'user', content: 'hello' }] });
      if (!Array.isArray(result.messages) || !result.max_tokens) throw new Error('OpenAI→Claude request translator did not register');
      const chunk = { type: 'message_start', message: { id: 'm1', model: 'claude-sonnet', content: [] } };
      const response = core.translateResponse('claude', 'openai', chunk, core.initState('openai'));
      if (response[0] === chunk || !response[0]?.choices) throw new Error('Claude→OpenAI response translator did not register');
    `);
  });

  it("keeps Local-only image and runtime modules out of the selective graph", async () => {
    const graph = await reachableFrom("register-serverless.js");
    assert.ok(!graph.some((path) => path.endsWith("/concerns/image.js")));
    assert.ok(!graph.some((path) => /^(node:dns|node:child_process|undici$)/.test(path)));
  });

  it("preserves the prior data-URI helper behavior", async () => {
    const { encodeDataUri, parseDataUri } = await import("../../open-sse/translator/concerns/dataUri.js");
    assert.equal(encodeDataUri("image/png", "a\nb"), "data:image/png;base64,a\nb");
    assert.deepEqual(parseDataUri("data:image/png;base64,a\nb"), { mimeType: "image/png", base64: "a\nb" });
    assert.equal(parseDataUri("https://example.com/image.png"), null);
    assert.equal(parseDataUri(null), null);
  });

  it("passes focused translator golden and roundtrip suites", () => {
    execFileSync("npm", ["exec", "--yes", "--package", "vitest@4", "--", "vitest", "run", "--config", "tests/vitest.config.js", "tests/translator/golden-request.test.js", "tests/translator/golden-response-stream.test.js", "tests/translator/format-roundtrip.test.js"], { cwd: root, stdio: "inherit" });
  });
});

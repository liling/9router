import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageVersion = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")).version;

function run(runtime, source, env = process.env) {
  const args = runtime === "node" ? ["--input-type=module", "-e", source] : ["--eval", source];
  return execFileSync(runtime, args, { cwd: repoRoot, env, encoding: "utf8" }).trim();
}

describe("local Node and Bun runtime smoke", () => {
  it.each(["node", "bun"])('%s resolves the package version in Kimi headers', runtime => {
    const output = run(runtime, `
      import { buildKimiHeaders } from "./open-sse/config/appConstants.js";
      console.log(buildKimiHeaders()["X-Msh-Version"]);
    `);
    expect(output).toBe(packageVersion);
    expect(output).not.toBe("0.0.0");
  });

  it("uses npm_package_version when the builtin module loader is unavailable", () => {
    const env = { ...process.env, npm_package_version: packageVersion };
    const output = run("node", `
      Object.defineProperty(process, "getBuiltinModule", { value: undefined });
      const { buildKimiHeaders } = await import("./open-sse/config/appConstants.js");
      console.log(buildKimiHeaders()["X-Msh-Version"]);
    `, env);
    expect(output).toBe(packageVersion);
  });

  it("imports Core and translates a request under Bun", () => {
    const output = run("bun", `
      import "./open-sse/translator/register-all.js";
      import { translateRequest } from "./open-sse/translator/index.js";
      import { FORMATS } from "./open-sse/translator/formats.js";
      const translated = translateRequest(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-3", {
        messages: [{ role: "user", content: "hello" }],
      }, true, null, "claude");
      console.log(JSON.stringify(translated));
    `);
    const translated = JSON.parse(output);
    expect(translated.messages[0].content).toEqual([{ type: "text", text: "hello" }]);
    expect(translated.model).toBe("claude-3");
  });
});

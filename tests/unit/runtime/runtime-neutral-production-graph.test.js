import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Protects the runtime-neutral production graph: the reachable closure of
 * runtime/context.js, runtime/capabilities.js, runtime/profiles/index.js,
 * executors/serverless.js, and translator/register-serverless.js.
 * Adding a root explicitly expands this architecture boundary.
 * Any future need for a Local-only exception requires an ADR root-set decision,
 * not a test-local whitelist change.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const roots = [
  'open-sse/runtime/context.js',
  'open-sse/runtime/capabilities.js',
  'open-sse/runtime/profiles/index.js',
  'open-sse/executors/serverless.js',
  'open-sse/translator/register-serverless.js',
  'src/lib/apiKeys/service.js',
  'cloud-poc/src/worker.js',
];
const compositionRoots = new Set(['cloud-poc/src/worker.js']);
const cloudflareBackgroundAdapter = 'open-sse/runtime/adapters/cloudflareBackgroundTasks.js';
const externalAllowlist = new Set(['node:crypto', 'crypto', 'node:os', 'os']);
const LOCAL_ONLY_EXEMPTIONS = [];
const vendorPackages = new Set(['undici', 'better-sqlite3', 'sql.js', 'node-machine-id', 'pg', 'pg-native']);
const adapterPathPrefixes = ['open-sse/runtime/adapters/', 'src/lib/db/adapters/'];
const localOnlyBuiltin = /^(?:node:)?(?:fs|child_process|dns|net|http2)(?:\/|$)|^bun:/;

function resolveLocalImport(fromFile, specifier) {
  let basePath;
  if (specifier.startsWith('.')) {
    basePath = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith('open-sse/')) {
    basePath = resolve(repoRoot, specifier);
  } else if (specifier.startsWith('@/')) {
    basePath = resolve(repoRoot, 'src', specifier.slice(2));
  } else {
    return undefined;
  }

  const candidates = [basePath];
  if (!/\.[a-z\d]+$/i.test(basePath)) {
    candidates.push(`${basePath}.js`, `${basePath}.mjs`, `${basePath}.cjs`, `${basePath}.json`);
    candidates.push(join(basePath, 'index.js'), join(basePath, 'index.mjs'));
  }
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function getImportSpecifiers(source) {
  return [
    ...[...source.matchAll(/^[\t ]*(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/gm)].map((match) => match[1]),
    ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
  ];
}

async function collectProductionGraph(graphRoots = roots) {
  const pending = graphRoots.map((root) => ({ file: resolve(repoRoot, root), root }));
  const visited = new Set();
  const forbiddenPaths = new Set();
  const forbiddenExternals = new Set();
  const externalSpecifiers = new Set();

  while (pending.length) {
    const { file: current, root } = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = readFileSync(current, 'utf8');

    for (const specifier of getImportSpecifiers(source)) {
      const localPath = resolveLocalImport(current, specifier);
      if (localPath) {
        const relativePath = localPath.slice(repoRoot.length + 1).replaceAll('\\', '/');
        if (adapterPathPrefixes.some((prefix) => relativePath.startsWith(prefix))
          && !(compositionRoots.has(root) && current === resolve(repoRoot, root))) {
          forbiddenPaths.add(`${relativePath} imported from ${current.slice(repoRoot.length + 1)}`);
        }
        pending.push({ file: localPath, root });
      } else if (specifier.startsWith('.') || specifier.startsWith('open-sse/') || specifier.startsWith('@/')) {
        forbiddenPaths.add(`${current}: unresolved ${specifier}`);
      } else {
        externalSpecifiers.add(specifier);
        if (vendorPackages.has(specifier) || localOnlyBuiltin.test(specifier)) {
          forbiddenExternals.add(specifier);
        }
      }
    }
  }

  return { forbiddenExternals, forbiddenPaths, externalSpecifiers, visited };
}

describe('runtime-neutral production graph (reachable closure of declared roots)', () => {
  it('resolves the declared roots and excludes adapters, vendor SDKs, and Local-only builtins', async () => {
    expect(roots.every((root) => existsSync(resolve(repoRoot, root)))).toBe(true);
    expect(LOCAL_ONLY_EXEMPTIONS).toEqual([]);

    const graph = await collectProductionGraph();
    expect([...graph.forbiddenPaths]).toEqual([]);
    expect([...graph.forbiddenExternals]).toEqual([]);
    expect([...graph.externalSpecifiers].filter((specifier) => !externalAllowlist.has(specifier))).toEqual([]);

    for (const file of graph.visited) {
      const relativePath = file.slice(repoRoot.length + 1).replaceAll('\\', '/');
      const source = readFileSync(file, 'utf8');
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (relativePath !== cloudflareBackgroundAdapter
        && !compositionRoots.has(relativePath)
        && !relativePath.startsWith('open-sse/runtime/profiles/')) {
        expect(code, `${relativePath} must not use Cloudflare lifecycle APIs`).not.toMatch(/\b(?:ExecutionContext|waitUntil)\b/);
      }
      if (relativePath.startsWith('open-sse/runtime/profiles/')) {
        const lifecycleLines = code.split('\n').filter((line) => /\b(?:ExecutionContext|waitUntil)\b/.test(line));
        expect(lifecycleLines.every((line) => /^\s*[\w]+:\s*[^,]*['"`][^'"`]*\b(?:ExecutionContext|waitUntil)\b/.test(line)), `${relativePath} may only describe lifecycle APIs as profile data`).toBe(true);
      }
      if (compositionRoots.has(relativePath)) {
        const lifecycleLines = code.split('\n').filter((line) => /\b(?:ExecutionContext|waitUntil)\b/.test(line));
        expect(lifecycleLines.every((line) => /^\s*import\b/.test(line)), `${relativePath} may only wire lifecycle APIs through imports`).toBe(true);
      }
    }

    const worker = readFileSync(resolve(repoRoot, 'cloud-poc/src/worker.js'), 'utf8');
    expect(worker).toMatch(/assertPort\(\s*['"]backgroundTasks['"]\s*\)/);
    expect(graph.visited.has(resolve(repoRoot, cloudflareBackgroundAdapter))).toBe(true);
  });

  it('keeps the OAuth application consumer independent of runtime EphemeralStore adapters', async () => {
    const oauthConsumerRoots = [
      'src/app/api/oauth/[provider]/[action]/route.js',
      'src/lib/oauth/utils/server.js',
    ];
    const oauthGraph = await collectProductionGraph(oauthConsumerRoots);
    const reachableEphemeralAdapters = [...oauthGraph.visited]
      .map((file) => file.slice(repoRoot.length + 1).replaceAll('\\', '/'))
      .filter((file) => file === 'open-sse/runtime/adapters/localEphemeralStore.js'
        || file === 'open-sse/runtime/adapters/d1/ephemeralStore.js');
    expect(reachableEphemeralAdapters).toEqual([]);
    expect([...oauthGraph.forbiddenPaths].filter((file) => file.includes(': unresolved '))).toEqual([]);

    for (const root of oauthConsumerRoots) {
      const source = readFileSync(resolve(repoRoot, root), 'utf8');
      expect(source).not.toMatch(/\bif\s*\([^)]*\b(?:cloudflare|redis|local)\b/i);
    }
  });
});

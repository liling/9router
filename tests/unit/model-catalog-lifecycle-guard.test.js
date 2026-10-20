import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('model catalog lifecycle boundary', () => {
  it('delegates recurring triggers instead of creating process timers', () => {
    const source = readFileSync(resolve(repoRoot, 'src/lib/modelCatalog/sync.js'), 'utf8');
    expect(source).not.toMatch(/\bset(?:Timeout|Interval)\s*\(/);
    expect(source).toMatch(/scheduler\.schedule\(\s*\{\s*id:\s*SCHEDULE_ID,\s*trigger:\s*\{\s*kind:\s*["']interval["'],\s*intervalMs:\s*delay\s*\},\s*handlerId:\s*HANDLER_ID,\s*execute:/s);
    expect(source).not.toMatch(/\b(?:ExecutionContext|waitUntil)\b/);
  });

  it('delegates Local lifecycle composition only from the positive Local profile branch', () => {
    const source = readFileSync(resolve(repoRoot, 'src/instrumentation.js'), 'utf8');
    expect(source.match(/resolveRuntimeProfile\(\)/g)).toHaveLength(1);
    expect(source).toMatch(/const runtimeProfile = resolveRuntimeProfile\(\);[\s\S]*?if\s*\(runtimeProfile\.isLocalPersistent\)\s*\{\s*const \{\s*startLocalComposition\s*\}\s*=\s*await import\(["']@\/lib\/runtime\/localComposition\.js["']\);\s*await startLocalComposition\(\);\s*\}/);
    expect(source.match(/startLocalComposition\(\)/g)).toHaveLength(1);
    expect(source).not.toMatch(/installRuntime|composeRuntime|createLocal(?:EphemeralStore|BackgroundTasks|IntervalScheduler)/);
    expect(source).not.toMatch(/isServerless|VERCEL|K_SERVICE|CF_PAGES/);
  });

  it('stamps the self-hosted entry only when no runtime profile was configured', () => {
    const source = readFileSync(resolve(repoRoot, 'custom-server.js'), 'utf8');
    expect(source).toContain('process.env.RUNTIME_PROFILE ||= "local-node";');
  });

  it('keeps deployment-vendor detection out of the catalog flow', () => {
    const source = readFileSync(resolve(repoRoot, 'src/lib/modelCatalog/sync.js'), 'utf8');
    expect(source).not.toMatch(/\b(?:VERCEL|CF_PAGES|K_SERVICE|ExecutionContext|waitUntil)\b/);
  });
});

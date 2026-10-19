import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('model catalog lifecycle boundary', () => {
  it('delegates recurring triggers instead of creating process timers', () => {
    const source = readFileSync(resolve(repoRoot, 'src/lib/modelCatalog/sync.js'), 'utf8');
    expect(source).not.toMatch(/\bset(?:Timeout|Interval)\s*\(/);
    expect(source).toContain('scheduler.schedule(');
    expect(source).not.toMatch(/\b(?:ExecutionContext|waitUntil)\b/);
  });

  it('only injects Local lifecycle adapters from the non-serverless composition branch', () => {
    const source = readFileSync(resolve(repoRoot, 'src/instrumentation.js'), 'utf8');
    expect(source).toMatch(/if\s*\(!isServerless\)\s*\{[\s\S]*?createLocalBackgroundTasks\(\)[\s\S]*?createLocalIntervalScheduler\(/);
    expect(source).toMatch(/if\s*\(catalogLifecycle\)\s*startModelCatalogSync\(catalogLifecycle\)/);
  });
});

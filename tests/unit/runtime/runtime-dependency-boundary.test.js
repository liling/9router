import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = fileURLToPath(new URL('../../../open-sse/runtime/', import.meta.url));

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? collectFiles(join(directory, entry.name))
    : [join(directory, entry.name)]));
  return nested.flat();
}

describe('runtime foundation module dependency boundary', () => {
  it('keeps runtime foundation modules free of adapter, vendor SDK, or runtime builtin imports', async () => {
    const files = await collectFiles(runtimeRoot);
    const sources = await Promise.all(files.map((file) => readFile(file, 'utf8')));
    const forbidden = /(?:from\s*|import\s*\()\s*['"](?:\.\/?[^'"]*adapters\/|(?:node:)?(?:fs|child_process|dns)|bun:|undici|better-sqlite3|sql\.js|node-machine-id)/;
    expect(sources.filter((source) => forbidden.test(source))).toEqual([]);
  });
});

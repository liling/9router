import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const sourceRoots = ['open-sse', 'src', 'cloud-poc/src'];
const pgImport = /\b(?:from\s*|import\s*\(|require\s*\()\s*['"](?:pg|pg-native)(?:\/[^'"]*)?['"]/g;

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? collectSourceFiles(join(directory, entry.name))
    : /\.(?:c|m)?js$/.test(entry.name) ? [join(directory, entry.name)] : []));
  return nested.flat();
}

describe('persistence vendor boundary', () => {
  it('keeps the PostgreSQL driver import inside its server-only adapter', async () => {
    const files = (await Promise.all(sourceRoots.map((root) => collectSourceFiles(join(repoRoot, root))))).flat();
    const importers = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (pgImport.test(source)) importers.push(relative(repoRoot, file).replaceAll('\\', '/'));
      pgImport.lastIndex = 0;
    }

    expect(importers).toEqual(['open-sse/runtime/adapters/postgres/apiKeyRepository.js']);
  });
});

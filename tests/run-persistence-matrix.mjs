import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, '..');
const commands = [
  {
    label: 'SQLite/PostgreSQL shared persistence contracts',
    args: [resolve(testsDir, 'node_modules/vitest/vitest.mjs'), 'run', 'unit/runtime/persistence/'],
    cwd: testsDir,
  },
  {
    label: 'D1 Workerd contract and Worker guards',
    args: ['--test', '--test-concurrency=1'],
    cwd: resolve(repoRoot, 'cloud-poc'),
  },
];

for (const command of commands) {
  console.log(`\n=== ${command.label} ===`);
  const result = spawnSync(process.execPath, command.args, { cwd: command.cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

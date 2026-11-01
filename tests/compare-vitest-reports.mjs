import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [basePath, finalPath] = process.argv.slice(2);
if (!basePath || !finalPath) {
  console.error('Usage: node tests/compare-vitest-reports.mjs <base.json> <final.json>');
  process.exit(2);
}

function readReport(path) {
  const report = JSON.parse(readFileSync(resolve(path), 'utf8'));
  const failed = report.testResults.flatMap((suite) =>
    suite.assertionResults
      .filter((test) => test.status === 'failed')
      .map((test) => `${suite.name.split('/tests/').at(-1)} :: ${test.fullName}`),
  );
  return { report, failed: new Set(failed) };
}

const base = readReport(basePath);
const final = readReport(finalPath);
const baseOnly = [...base.failed].filter((test) => !final.failed.has(test)).sort();
const finalOnly = [...final.failed].filter((test) => !base.failed.has(test)).sort();

console.log(JSON.stringify({
  base: {
    tests: base.report.numTotalTests,
    failed: base.report.numFailedTests,
    pending: base.report.numPendingTests,
  },
  final: {
    tests: final.report.numTotalTests,
    failed: final.report.numFailedTests,
    pending: final.report.numPendingTests,
  },
  baseOnlyFailures: baseOnly,
  finalOnlyFailures: finalOnly,
  currentOnlyFailures: finalOnly.length,
}, null, 2));

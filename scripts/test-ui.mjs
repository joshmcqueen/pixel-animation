import { spawn } from 'node:child_process';
import electron from 'electron';
import { readFile, rm } from 'node:fs/promises';

const report = '.cache/ui-smoke/report.json';
await rm(report, { force: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['tests/ui-smoke.cjs'], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', async code => {
  try {
    const result = JSON.parse(await readFile(report, 'utf8'));
    process.exitCode = code === 0 && result.passed ? 0 : 1;
  } catch { process.exitCode = 1; }
});

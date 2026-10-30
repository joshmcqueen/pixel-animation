import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'electron');
await mkdir(cache, { recursive: true });
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron/install.js')], {
  cwd: root,
  env: { ...process.env, ELECTRON_CACHE: cache, electron_config_cache: cache },
  stdio: 'inherit',
});
process.exitCode = result.status ?? 1;

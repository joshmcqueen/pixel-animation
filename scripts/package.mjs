import { packager } from '@electron/packager';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIcon } from './icon.mjs';

const root = process.cwd();
const staging = path.join(root, '.cache', 'package-input');
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const dir of ['dist', 'dist-main']) await cp(path.join(root, dir), path.join(staging, dir), { recursive: true });
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(staging, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main, type: 'module' }));
const outputs = await packager({
  dir: staging,
  name: 'Stride',
  executableName: 'Stride',
  platform: 'darwin',
  arch: 'arm64',
  out: path.join(root, 'release'),
  overwrite: true,
  appBundleId: 'local.stride.framepicker',
  icon: await buildIcon(path.join(root, '.cache', 'icon')),
  appCategoryType: 'public.app-category.graphics-design',
  electronVersion: JSON.parse(await readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version,
  download: { cacheRoot: path.join(root, '.cache', 'electron') },
  tmpdir: path.join(root, '.cache', 'packager'),
});
await rm(staging, { recursive: true, force: true });
console.log(`Built ${path.join(outputs[0], 'Stride.app')}`);

#!/usr/bin/env node
/**
 * Ensures the self-hosted Inter webfont files exist in src/assets/fonts.
 *
 * The built application never requests a font from the internet. The files are
 * committed to the repository, so a normal clone already works offline. This
 * script exists so a fresh checkout (or a machine that lost the files) can
 * restore them from the installed npm package while online.
 *
 * Usage: npm run fetch-assets
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = join(root, 'src', 'assets', 'fonts');
const pkgDir = join(root, 'node_modules', '@fontsource-variable', 'inter', 'files');

const wanted = ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'];

mkdirSync(fontDir, { recursive: true });

if (!existsSync(fontDir) || readdirSync(fontDir).length === 0) {
  mkdirSync(fontDir, { recursive: true });
}

for (const name of wanted) {
  const source = join(pkgDir, name);
  const target = join(fontDir, name);
  if (!existsSync(source)) {
    console.warn(`[assets] missing ${source} — run "npm install" first`);
    continue;
  }
  if (existsSync(target)) {
    console.log(`[assets] ${name} already present`);
    continue;
  }
  copyFileSync(source, target);
  console.log(`[assets] copied ${name}`);
}

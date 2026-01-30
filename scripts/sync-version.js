#!/usr/bin/env node
/**
 * Sync version from package.json to manifest files
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Sync manifest file
const manifestPath = join(root, 'openclaw.plugin.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');

console.log(`Synced version to ${pkg.version}`);

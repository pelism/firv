import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const versionFilePath = path.join(repoRoot, 'src', 'version.ts');

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
const version = packageJson.version;

if (typeof version !== 'string' || version.length === 0) {
  throw new Error('package.json is missing a valid version string.');
}

const contents = `export const APP_VERSION = '${version}';\n`;

await writeFile(versionFilePath, contents, 'utf8');
console.log(`Wrote ${versionFilePath} with version ${version}`);

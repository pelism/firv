import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const extension = process.platform === 'win32' ? '.exe' : '';

const targetTriple =
  process.env.CARGO_BUILD_TARGET ||
  process.env.TARGET_TRIPLE ||
  execSync('rustc --print host-tuple', { cwd: 'src-tauri' }).toString().trim();

if (!targetTriple) {
  console.error('Failed to determine Rust target triple');
  process.exit(1);
}

const buildArgs = ['build', '--bin', 'firv-cli', '--release'];
if (process.env.CARGO_BUILD_TARGET) {
  buildArgs.push('--target', process.env.CARGO_BUILD_TARGET);
}

const sourceDir = process.env.CARGO_BUILD_TARGET
  ? path.join('src-tauri', 'target', targetTriple, 'release')
  : path.join('src-tauri', 'target', 'release');

const sourceBin = path.join(sourceDir, `firv-cli${extension}`);
const destDir = path.join('src-tauri', 'binaries');
const destBin = path.join(destDir, `firv-cli-${targetTriple}${extension}`);

fs.mkdirSync(destDir, { recursive: true });

// Remove any previously-staged firv-cli sidecars to avoid stale mismatched targets.
for (const entry of fs.readdirSync(destDir)) {
  if (entry.startsWith('firv-cli-')) {
    fs.unlinkSync(path.join(destDir, entry));
  }
}

// Create a placeholder sidecar so tauri_build's externalBin check passes
// while compiling firv-cli (which depends on firv_lib). The real binary
// will overwrite this once cargo finishes.
fs.writeFileSync(destBin, '');

execSync(`cargo ${buildArgs.join(' ')}`, {
  cwd: 'src-tauri',
  stdio: 'inherit',
});

if (!fs.existsSync(sourceBin)) {
  console.error(`Source binary not found: ${sourceBin}`);
  process.exit(1);
}

fs.copyFileSync(sourceBin, destBin);
console.log(`Staged firv-cli sidecar: ${destBin}`);

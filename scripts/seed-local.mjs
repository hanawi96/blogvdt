import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extraArgs = process.argv.slice(2);
const asksForRemote = extraArgs.some((arg) => arg === '--remote' || arg.startsWith('--remote'));
if (asksForRemote) {
  console.error('Seed chỉ được chạy trên D1 local. Không dùng --remote.');
  process.exit(1);
}

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptsDir, '..');
const wranglerPath = path.join(projectDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const seedFile = path.join(scriptsDir, 'seed.sql');

const result = spawnSync(
  process.execPath,
  [wranglerPath, 'd1', 'execute', 'vong-dau-tam', '--local', '--file', seedFile],
  { cwd: projectDir, stdio: 'inherit' },
);

if (result.error) {
  console.error('Không chạy được Wrangler để seed D1 local.');
  process.exit(1);
}

process.exit(result.status ?? 1);

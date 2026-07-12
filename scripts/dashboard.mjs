import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
if (!['dev', 'build', 'start'].includes(command)) {
  console.error('Usage: node scripts/dashboard.mjs <dev|build|start> [...next arguments]');
  process.exit(2);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const environmentFile = join(root, '.env');
if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);

const next = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const result = spawnSync(
  process.execPath,
  [next, command, join(root, 'apps', 'dashboard'), ...process.argv.slice(3)],
  { cwd: root, env: process.env, stdio: 'inherit' },
);

if (result.error) {
  console.error(`Unable to start Next.js: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

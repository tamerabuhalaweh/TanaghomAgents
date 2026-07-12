import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'coverage', 'dist', '.next']);
const textExtensions = new Set([
  '.env', '.example', '.json', '.md', '.mjs', '.sql', '.ts', '.tsx', '.yml', '.yaml',
]);
const required = [
  'README.md',
  'CONTRIBUTING.md',
  '.env.example',
  'docs/ROADMAP.md',
  'docs/DEFINITION_OF_DONE.md',
  'docs/architecture/0001-platform-boundaries.md',
];
const suspicious = [
  /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}/i,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]{8,}@(?!(?:localhost|127\.0\.0\.1))/i,
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(path));
    else files.push(path);
  }
  return files;
}

const files = await collect(root);
const names = new Set(files.map((path) => relative(root, path).replaceAll('\\', '/')));
const failures = [];

for (const path of required) {
  if (!names.has(path)) failures.push(`missing required file: ${path}`);
}

for (const path of files) {
  const extension = extname(path);
  if (!textExtensions.has(extension) && !path.endsWith('.env.example')) continue;
  const content = await readFile(path, 'utf8');
  for (const pattern of suspicious) {
    if (pattern.test(content)) failures.push(`possible committed secret: ${relative(root, path)}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Repository verification passed (${files.length} files checked).`);

// Planning-data checks only. No application, database, provider or deployment writes.
// --github adds a read-only issue/snapshot comparison using authenticated gh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const base = 'docs/planning/agency-expansion';
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const catalog = JSON.parse(read(base + '/catalog.v1.json'));
const index = JSON.parse(read(base + '/issue-index.v1.json'));
const githubChecked = process.argv.includes('--github');

assert.match(catalog.upstream.tree_sha, /^[a-f0-9]{40}$/);
assert.notEqual(catalog.upstream.tree_sha, catalog.upstream.commit);
assert.equal(catalog.profiles.length, 273);
assert.equal(catalog.divisions.length, 18);
assert.equal(new Set(catalog.profiles.map((profile) => profile.path)).size, 273);
assert.equal(catalog.profiles.filter((profile) => profile.pilot_profile).length, 6);
assert.equal(index.issues.length, 17);
assert.equal(new Set(index.issues.map((issue) => issue.number)).size, 17);

for (const division of catalog.divisions) {
  const profiles = catalog.profiles.filter((profile) => profile.division === division.code);
  assert.equal(profiles.length, division.profile_count);
  assert(index.issues.some((issue) => issue.number === division.tracking_issue));
}

for (const profile of catalog.profiles) {
  assert.match(profile.git_blob_sha1, /^[a-f0-9]{40}$/);
  assert.match(profile.content_sha256, /^[a-f0-9]{64}$/);
  assert(profile.bytes > 0);
  assert.equal(profile.catalog_state, 'catalogued');
  assert.equal(profile.semantic_review, 'pending');
  for (const state of ['adapted', 'tested', 'available', 'activated']) {
    assert.equal(profile[state], false);
  }
  assert(index.issues.some((issue) => issue.number === profile.tracking_issue));
  assert(profile.source_url.includes(catalog.upstream.commit));
}

// Git checkouts may use CRLF on Windows; reproduce the source's LF bytes.
const license = read(base + '/UPSTREAM_LICENSE.txt').replace(/\r\n/g, '\n');
assert.equal(
  createHash('sha256').update(license).digest('hex'),
  catalog.upstream.license_sha256,
);

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  });
}

const files = [
  ...collectFiles(path.join(root, base)),
  ...[
    'README.md',
    'CONTRIBUTING.md',
    'docs/STATUS.md',
    'docs/PROJECT_CONTEXT.md',
    'docs/ROADMAP.md',
    'docs/architecture/0018-ai-organization-expansion.md',
  ].map((relativePath) => path.join(root, relativePath)),
];
let linkCount = 0;

for (const file of files.filter((name) => name.endsWith('.md'))) {
  const text = fs.readFileSync(file, 'utf8');
  assert(!text.includes('{{'), file + ' contains an unresolved placeholder');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const destination = target.split('#')[0];
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(destination));
    assert(fs.existsSync(resolved), file + ' has a missing link: ' + target);
    linkCount += 1;
  }
}

function getIssue(number) {
  return JSON.parse(execFileSync(
    'gh',
    ['api', 'repos/tamerabuhalaweh/TanaghomAgents/issues/' + number],
    { encoding: 'utf8', timeout: 20000, cwd: root },
  ));
}

const normalize = (text) => text.replace(/\r\n/g, '\n').trim();
if (githubChecked) {
  for (const issue of index.issues) {
    const live = getIssue(issue.number);
    assert.equal(
      normalize(live.body),
      normalize(read(base + '/' + issue.snapshot)),
      'Issue #' + issue.number + ' differs from its versioned snapshot',
    );
    assert.equal(live.title, issue.title);
    assert.equal(live.state, 'open');
  }
  for (const number of [125, 131, 137]) {
    const live = getIssue(number);
    assert.equal(
      normalize(live.body),
      normalize(read(base + '/existing-issues/' + number + '.md')),
      'Existing issue #' + number + ' differs from its versioned snapshot',
    );
    assert.equal(live.state, 'open');
  }
}

console.log(JSON.stringify({
  github_checked: githubChecked,
  catalog_profiles: 273,
  divisions: 18,
  pilot_candidates: 6,
  new_issue_snapshots: 17,
  reconciled_existing_snapshots: 3,
  local_markdown_links: linkCount,
  result: 'PASS',
}));

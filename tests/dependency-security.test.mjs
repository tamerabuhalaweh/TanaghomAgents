import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import uri from 'fast-uri';

test('PostCSS does not read an absolute untrusted source map when from is unset', async () => {
  const mapPath = fileURLToPath(new URL('./fixtures/dependency-security.map', import.meta.url));
  const result = await postcss([]).process(`a{color:red}\n/*# sourceMappingURL=${mapPath} */`, {
    from: undefined,
    map: { inline: false, annotation: false },
  });
  assert.doesNotMatch(JSON.stringify(result.map?.toJSON()), /TANAGHOM_SYNTHETIC_SOURCE_MAP_CANARY/);
  assert.equal(result.root.first.first.value, 'red');
  const trusted = await postcss([]).process('a{color:red}', {
    from: undefined,
    map: { prev: await readFile(mapPath, 'utf8'), inline: false, annotation: false },
  });
  assert.match(JSON.stringify(trusted.map.toJSON()), /TANAGHOM_SYNTHETIC_SOURCE_MAP_CANARY/);
});

test('Nano ID zero-sized custom generators terminate without hanging the test runner', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { customAlphabet, customRandom } from 'nanoid';
    assert.equal(customAlphabet('abc', 0)(), '');
    assert.equal(customAlphabet('abc', 8)(0), '');
    assert.equal(customRandom('abc', 0, size => new Uint8Array(size))(), '');
    assert.equal(customAlphabet('abc', 8)().length, 8);
  `], { timeout: 5000, encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('URI resolution canonicalizes the effective host before policy comparison', () => {
  const resolved = uri.resolve('https://example.test/', '//b\u00fccher.test/path');
  assert.equal(resolved, 'https://xn--bcher-kva.test/path');
  assert.equal(uri.parse(resolved).host, new URL(resolved).hostname);
});

test('URI normalization does not repeatedly decode a nested encoded loopback host', () => {
  const input = 'http://%256c%256f%2563%2561%256c%2568%256f%2573%2574/';
  assert.notEqual(uri.normalize(input), 'http://localhost/');
  assert.notEqual(uri.resolve('http://example.test/', input), 'http://localhost/');
});

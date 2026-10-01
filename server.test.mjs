import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLearningServer, parseSetTexts } from './server.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

async function startServer(t, directory = root) {
  const server = createLearningServer(directory);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function temporaryRoot(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'translation-learning-test-'));
  t.after(async () => {
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('translation-learning-test-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return temporary;
}

test('one Chinese sentence can retain several English sentences, including a 5G opening', () => {
  const data = parseSetTexts('\uFEFF5G 网络覆盖全国。第二句。\r\n', '\uFEFF5G 网络覆盖全国。\r\n5G networks cover China. Coverage is extensive.\r\n\r\n第二句。\r\nSecond sentence.\r\n');
  assert.equal(data.sentences.length, 2);
  assert.equal(data.sentences[0].reference, '5G networks cover China. Coverage is extensive.');
});

test('invalid or mismatched bilingual text produces an actionable error', () => {
  assert.throws(() => parseSetTexts('', ''), /为空/);
  assert.throws(() => parseSetTexts('原句。', '原句。'), /第 1 组格式有误/);
  assert.throws(() => parseSetTexts('原句。', '其他句。\nAnother sentence.'), /中文不一致/);
});

test('all six existing sets load with the correct Chinese and English pair counts', async t => {
  const base = await startServer(t);
  const expected = [
    ['December-2025/Set-1', 6], ['December-2025/Set-2', 5], ['December-2025/Set-3', 4],
    ['June-2025/Set-1', 5], ['June-2025/Set-2', 5], ['June-2025/Set-3', 5],
  ];
  const rootResult = await (await fetch(`${base}/api/folders`)).json();
  assert.ok(rootResult.entries.some(entry => entry.name === 'CET-6-Translation-Exams' && entry.type === 'folder'));
  for (const [relative, count] of expected) {
    const folder = `CET-6-Translation-Exams/${relative}`;
    const response = await fetch(`${base}/api/set?path=${encodeURIComponent(folder)}`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sentences.length, count);
    const original = await readFile(path.join(root, folder, 'Original-Questions.txt'), 'utf8');
    assert.equal(result.original, original.trim());
    assert.equal(result.sentences.map(sentence => sentence.chinese).join('').replace(/\s/g, ''), original.replace(/\s/g, ''));
    assert.ok(result.sentences.every(sentence => sentence.reference.length > 10));
  }
});

test('new non-CET folders become browsable without restarting the server', async t => {
  const temporary = await temporaryRoot(t);
  const base = await startServer(t, temporary);
  assert.deepEqual((await (await fetch(`${base}/api/folders`)).json()).entries, []);
  const folder = '其他翻译/新闻 练习/Set-2';
  await mkdir(path.join(temporary, folder), { recursive: true });
  await writeFile(path.join(temporary, folder, 'Original-Questions.txt'), '新增题目。');
  await writeFile(path.join(temporary, folder, 'Reference-Answers.txt'), '新增题目。\nA new question.\n');
  const rootData = await (await fetch(`${base}/api/folders`)).json();
  assert.equal(rootData.entries[0].name, '其他翻译');
  const nested = await (await fetch(`${base}/api/folders?path=${encodeURIComponent('其他翻译/新闻 练习')}`)).json();
  assert.equal(nested.entries[0].type, 'set');
  const set = await (await fetch(`${base}/api/set?path=${encodeURIComponent(folder)}`)).json();
  assert.equal(set.sentences[0].chinese, '新增题目。');
});

test('incomplete sets and malformed files fail clearly', async t => {
  const temporary = await temporaryRoot(t);
  await mkdir(path.join(temporary, 'Incomplete'));
  await writeFile(path.join(temporary, 'Incomplete', 'Original-Questions.txt'), '原句。');
  const base = await startServer(t, temporary);
  const response = await fetch(`${base}/api/set?path=Incomplete`);
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /同时包含/);
  assert.equal((await fetch(`${base}/api/set?path=Missing`)).status, 404);
});

test('directory traversal, hidden files, symlinks, non-loopback hosts, and arbitrary static files are blocked', async t => {
  const temporary = await temporaryRoot(t);
  await mkdir(path.join(temporary, '.private'));
  await mkdir(path.join(temporary, 'node_modules'));
  const base = await startServer(t, temporary);
  for (const folder of ['../', '.private', 'node_modules', '..\\', '../../Windows']) {
    const response = await fetch(`${base}/api/folders?path=${encodeURIComponent(folder)}`);
    assert.ok([400, 403].includes(response.status), folder);
  }
  assert.equal((await fetch(`${base}/server.mjs`)).status, 404);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = get(`${base}/api/folders`, { headers: { host: 'example.com' } }, response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  await symlink(tmpdir(), path.join(temporary, 'External'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(`${base}/api/folders?path=External`)).status, 403);
  const listing = await (await fetch(`${base}/api/folders`)).json();
  assert.ok(!listing.entries.some(entry => ['.private', 'node_modules', 'External'].includes(entry.name)));
});

test('the app document and local assets are served with their correct types', async t => {
  const base = await startServer(t);
  for (const [route, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'text/javascript']]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok((await response.text()).length > 100);
  }
});

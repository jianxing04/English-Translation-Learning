import http from 'node:http';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const questionFile = 'Original-Questions.txt';
const answerFile = 'Reference-Answers.txt';
const ignoredFolders = new Set(['node_modules']);
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
}

function normalizeChinese(text) {
  return text.replace(/\s+/gu, '');
}

// The bilingual blocks provide reliable boundaries, even when one Chinese
// sentence is translated into several English sentences.
export function parseSetTexts(originalText, referenceText) {
  const original = cleanText(originalText);
  const reference = cleanText(referenceText);
  if (!original || !reference) {
    throw new RequestError(422, '原题或参考译文为空，请补充题目文件。');
  }
  const sentences = reference.split(/\n[\t ]*\n+/).map((block, index) => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length < 2 || !/[\u3400-\u9fff]/u.test(lines[0])) {
      throw new RequestError(422, `参考译文的第 ${index + 1} 组格式有误：请先写中文，下一行写英文，句组之间空一行。`);
    }
    return { chinese: lines[0], reference: lines.slice(1).join(' ') };
  });
  if (normalizeChinese(sentences.map(item => item.chinese).join('')) !== normalizeChinese(original)) {
    throw new RequestError(422, '原题与参考译文中的中文不一致，请检查两份文件是否属于同一套题。');
  }
  return { original, sentences };
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function resolveDirectory(root, requestedPath = '') {
  if (typeof requestedPath !== 'string' || requestedPath.includes('\0') || requestedPath.includes('\\')) {
    throw new RequestError(400, '目录路径无效。');
  }
  const segments = requestedPath.split('/').filter(Boolean);
  if (segments.some(segment => segment === '..' || segment.startsWith('.') || ignoredFolders.has(segment))) {
    throw new RequestError(403, '无法访问这个目录。');
  }
  const candidate = path.resolve(root, ...segments);
  if (!insideRoot(root, candidate)) throw new RequestError(403, '目录超出题库范围。');
  const resolved = await realpath(candidate);
  if (!insideRoot(root, resolved)) throw new RequestError(403, '目录超出题库范围。');
  if (!(await stat(resolved)).isDirectory()) throw new RequestError(400, '请选择一个文件夹。');
  return { absolute: resolved, relative: segments.join('/') };
}

async function setFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  return { hasQuestions: files.has(questionFile), hasAnswers: files.has(answerFile), entries };
}

async function browse(root, requestedPath) {
  const directory = await resolveDirectory(root, requestedPath);
  const { entries } = await setFiles(directory.absolute);
  const folders = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !ignoredFolders.has(entry.name));
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  const children = await Promise.all(folders.map(async entry => {
    const folderPath = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
    const files = await setFiles(path.join(directory.absolute, entry.name));
    return {
      name: entry.name,
      path: folderPath,
      type: files.hasQuestions && files.hasAnswers ? 'set' : 'folder',
      hasQuestions: files.hasQuestions,
      hasAnswers: files.hasAnswers,
    };
  }));
  return {
    path: directory.relative,
    parent: directory.relative.includes('/') ? directory.relative.slice(0, directory.relative.lastIndexOf('/')) : '',
    entries: children,
  };
}

async function loadSet(root, requestedPath) {
  const directory = await resolveDirectory(root, requestedPath);
  const files = await setFiles(directory.absolute);
  if (!files.hasQuestions || !files.hasAnswers) {
    throw new RequestError(422, '这套题需要同时包含 Original-Questions.txt 和 Reference-Answers.txt。');
  }
  const [original, reference] = await Promise.all([
    readFile(path.join(directory.absolute, questionFile), 'utf8'),
    readFile(path.join(directory.absolute, answerFile), 'utf8'),
  ]);
  return { path: directory.relative, name: path.basename(directory.absolute), ...parseSetTexts(original, reference) };
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export function createLearningServer(root = projectRoot) {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      // A local filesystem reader should only answer requests addressed to loopback.
      const host = (request.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) throw new RequestError(403, '请通过本地网站地址访问。');
      if (request.method !== 'GET') throw new RequestError(405, '仅支持读取题库。');
      const url = new URL(request.url, 'http://127.0.0.1');
      const requestedPath = url.searchParams.get('path') || '';
      if (url.pathname === '/api/folders') {
        sendJson(response, 200, await browse(await realpath(root), requestedPath));
      } else if (url.pathname === '/api/set') {
        sendJson(response, 200, await loadSet(await realpath(root), requestedPath));
      } else if (staticFiles.has(url.pathname)) {
        const [filename, contentType] = staticFiles.get(url.pathname);
        const content = await readFile(path.join(projectRoot, filename));
        response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        response.end(content);
      } else {
        throw new RequestError(404, '没有找到这个页面。');
      }
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : error.code === 'EACCES' ? 403 : 500);
      const message = error.status ? error.message : status === 404 ? '目录或文件不存在，请刷新题库后重试。' : status === 403 ? '无法读取这个目录。' : '读取题库失败，请检查文件后重试。';
      if (status === 500) console.error(error);
      sendJson(response, status, { error: message });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT 必须是 1–65535 之间的整数。');
    process.exit(1);
  }
  const server = createLearningServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。如果已经启动过网站，请直接打开 http://127.0.0.1:${port}/` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${port}/`;
    console.log(`\n译习 · 英语翻译训练\n\n网站地址：${address}\n题库目录：${projectRoot}\n\n保留此窗口以使用网站，按 Ctrl+C 停止。\n`);
    if (process.argv.includes('--open')) {
      const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', address] : [address];
      const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
      browser.on('error', () => console.log(`请在浏览器中打开 ${address}`));
      browser.unref();
    }
  });
}

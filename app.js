const $ = id => document.getElementById(id);
const state = { folder: '', data: null, index: 0, drafts: new Map(), positions: new Map(), browseRequest: 0, setRequest: 0 };
const folderSvg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.5"/></svg>';
const setSvg = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 3v5h5M9 12h7M9 16h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

async function api(endpoint, folder) {
  const response = await fetch(`${endpoint}?path=${encodeURIComponent(folder)}`, { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '读取题库失败，请重试。');
  return result;
}

function clearError() { $('main-error').hidden = true; }
function showError(error) {
  $('main-error').textContent = error.message;
  $('main-error').hidden = false;
}

function renderBreadcrumbs(folder) {
  const nav = $('breadcrumbs');
  nav.replaceChildren();
  const parts = folder.split('/').filter(Boolean);
  const links = [{ name: '根目录', path: '' }, ...parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') }))];
  links.forEach((link, index) => {
    if (index) {
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-divider';
      separator.textContent = '/';
      separator.setAttribute('aria-hidden', 'true');
      nav.append(separator);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = link.name;
    if (index === links.length - 1) { button.className = 'current'; button.setAttribute('aria-current', 'location'); }
    button.addEventListener('click', () => browseFolder(link.path));
    nav.append(button);
  });
}

function folderMessage(message, isError = false) {
  const paragraph = document.createElement('p');
  paragraph.className = `directory-message${isError ? ' error' : ''}`;
  paragraph.textContent = message;
  $('folder-list').replaceChildren(paragraph);
}

function markSelectedFolder() {
  for (const button of $('folder-list').querySelectorAll('.folder-item')) {
    const selected = button.dataset.path === state.data?.path;
    button.classList.toggle('selected', selected);
    if (selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

async function browseFolder(folder = '') {
  const request = ++state.browseRequest;
  $('refresh-folders').disabled = true;
  folderMessage('正在读取目录…');
  try {
    const data = await api('/api/folders', folder);
    if (request !== state.browseRequest) return;
    state.folder = data.path;
    renderBreadcrumbs(data.path);
    $('folder-caption').textContent = data.path.split('/').at(-1) || '根目录';
    $('parent-folder').hidden = !data.path;
    $('parent-folder').onclick = () => browseFolder(data.parent);
    $('folder-list').replaceChildren();
    if (!data.entries.length) folderMessage('这个文件夹下暂时没有套题或子文件夹。');
    for (const entry of data.entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `folder-item${entry.type === 'set' ? ' is-set' : ''}`;
      button.dataset.path = entry.path;
      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.innerHTML = entry.type === 'set' ? setSvg : folderSvg;
      const info = document.createElement('span');
      info.className = 'folder-info';
      const name = document.createElement('span');
      name.className = 'folder-name';
      name.textContent = entry.name;
      const kind = document.createElement('span');
      kind.className = 'folder-kind';
      kind.textContent = entry.type === 'set' ? '套题 · 开始练习' : entry.hasQuestions || entry.hasAnswers ? '题目文件不完整' : '文件夹';
      info.append(name, kind);
      button.append(icon, info);
      button.addEventListener('click', () => {
        if (entry.type === 'set' || entry.hasQuestions || entry.hasAnswers) selectSet(entry.path);
        else browseFolder(entry.path);
      });
      $('folder-list').append(button);
    }
    markSelectedFolder();
  } catch (error) {
    if (request !== state.browseRequest) return;
    folderMessage(location.protocol === 'file:' ? '请使用“启动学习网站.cmd”打开网站，才能读取题库文件夹。' : error.message, true);
    // Keep the current location and parent controls available after a failed refresh.
    renderBreadcrumbs(state.folder);
  } finally {
    if (request === state.browseRequest) $('refresh-folders').disabled = false;
  }
}

function draftsForCurrentSet() {
  if (!state.data) return [];
  if (!state.drafts.has(state.data.path)) state.drafts.set(state.data.path, []);
  return state.drafts.get(state.data.path);
}

async function selectSet(folder) {
  const request = ++state.setRequest;
  clearError();
  try {
    const data = await api('/api/set', folder);
    if (request !== state.setRequest) return;
    state.data = data;
    state.index = Math.min(state.positions.get(folder) || 0, data.sentences.length - 1);
    $('welcome').hidden = true;
    $('practice').hidden = false;
    $('set-location').textContent = data.path.split('/').slice(0, -1).join(' / ');
    $('set-title').textContent = data.name;
    $('sentence-count').textContent = `共 ${data.sentences.length} 句`;
    renderSentenceTabs();
    renderSentence();
    markSelectedFolder();
    if (window.matchMedia('(max-width: 720px)').matches) $('practice').scrollIntoView({ behavior: 'instant', block: 'start' });
  } catch (error) {
    if (request === state.setRequest) showError(error);
  }
}

function renderSentenceTabs() {
  const tabs = $('sentence-tabs');
  tabs.replaceChildren();
  state.data.sentences.forEach((sentence, index) => {
    const button = document.createElement('button');
    button.className = 'sentence-tab';
    button.type = 'button';
    button.textContent = index + 1;
    button.setAttribute('aria-label', `练习第 ${index + 1} 句`);
    button.addEventListener('click', () => navigateSentence(index));
    tabs.append(button);
  });
  updateCompletion();
}

function updateCompletion() {
  const drafts = draftsForCurrentSet();
  const completed = state.data.sentences.reduce((count, _, index) => count + (drafts[index]?.trim() ? 1 : 0), 0);
  $('completion-count').textContent = `${completed} / ${state.data.sentences.length}`;
  [...$('sentence-tabs').children].forEach((tab, index) => {
    tab.classList.toggle('active', index === state.index);
    tab.classList.toggle('filled', Boolean(drafts[index]?.trim()));
    tab.setAttribute('aria-pressed', String(index === state.index));
  });
}

function fitTextarea(element) {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight + 3}px`;
}

function setReferenceVisible(visible) {
  $('reference-content').hidden = !visible;
  $('reference-hint').hidden = visible;
  $('toggle-reference').textContent = visible ? '隐藏参考译文' : '显示参考译文';
  $('toggle-reference').setAttribute('aria-expanded', String(visible));
  if (visible) fitTextarea($('reference-text'));
}

function updateEvaluation() {
  const translation = $('translation-input').value;
  const sentence = state.data.sentences[state.index];
  $('evaluation-text').value = `中文原句：\n${sentence.chinese}\n\n我的译文：\n${translation}`;
  const words = translation.trim().match(/\S+/g)?.length || 0;
  $('word-count').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  $('copy-status').textContent = '';
  fitTextarea($('evaluation-text'));
}

function renderSentence() {
  const sentence = state.data.sentences[state.index];
  $('chinese-text').value = sentence.chinese;
  $('translation-input').value = draftsForCurrentSet()[state.index] || '';
  $('reference-text').value = sentence.reference;
  $('position-label').textContent = `第 ${state.index + 1} / ${state.data.sentences.length} 句`;
  $('previous-sentence').disabled = state.index === 0;
  $('next-sentence').disabled = state.index === state.data.sentences.length - 1;
  setReferenceVisible(false);
  updateEvaluation();
  updateCompletion();
  fitTextarea($('chinese-text'));
}

function navigateSentence(index) {
  if (!state.data || index < 0 || index >= state.data.sentences.length) return;
  state.index = index;
  state.positions.set(state.data.path, index);
  renderSentence();
}

$('translation-input').addEventListener('input', () => {
  if (!state.data) return;
  draftsForCurrentSet()[state.index] = $('translation-input').value;
  updateEvaluation();
  updateCompletion();
});
$('previous-sentence').addEventListener('click', () => navigateSentence(state.index - 1));
$('next-sentence').addEventListener('click', () => navigateSentence(state.index + 1));
$('toggle-reference').addEventListener('click', () => setReferenceVisible($('reference-content').hidden));
$('refresh-folders').addEventListener('click', () => browseFolder(state.folder));
$('copy-evaluation').addEventListener('click', async () => {
  const text = $('evaluation-text').value;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    $('copy-status').textContent = '已复制，可粘贴到外部 AI 平台评分。';
  } catch {
    $('evaluation-text').focus();
    $('evaluation-text').select();
    $('copy-status').textContent = '文本已全选，请按 Ctrl+C 复制。';
  }
});

window.addEventListener('resize', () => {
  if (!state.data) return;
  fitTextarea($('chinese-text'));
  fitTextarea($('evaluation-text'));
  if (!$('reference-content').hidden) fitTextarea($('reference-text'));
});

renderBreadcrumbs('');
browseFolder();

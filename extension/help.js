// Help & memory page: settings, both modes' saved items, backup export/import, added sites.
// Reads and writes the same memory the shop widget uses, so open shop tabs update straight away.
import { getUserSites, SITES_KEY } from './sites.js';

const KEY = 'vf_user_memory_v1';
const MODES = ['vegetarian', 'vegan'];
const LIST_KEYS = ['blockedProducts', 'allowedProducts', 'customBlockedWords'];
const MAX_LIST = 5000;
const $ = (id) => document.getElementById(id);

// Same cleaning as the widget: short, lower-case, trimmed, no blanks, capped
const cleanList = (arr) => [...new Set(arr
  .filter(v => typeof v === 'string')
  .map(v => v.toLowerCase().replace(/\s+/g, ' ').trim())
  .filter(v => v.length >= 2 && v.length <= 300))].slice(0, MAX_LIST);

// Accepts the current per-mode format and older flat backups (copied into both modes)
function mergeLists(mem, src) {
  MODES.forEach(m => LIST_KEYS.forEach(k => {
    const fromMode = src?.lists?.[m]?.[k];
    const fromFlat = src?.[k];
    mem.lists[m][k] = cleanList([...mem.lists[m][k], ...(Array.isArray(fromMode) ? fromMode : []), ...(Array.isArray(fromFlat) ? fromFlat : [])]);
  }));
}

function normalize(saved) {
  const mem = {
    mode: saved?.mode === 'vegan' ? 'vegan' : 'vegetarian',
    action: saved?.action === 'hide' ? 'hide' : 'dim',
    minimised: saved?.minimised === true,
    lists: { vegetarian: {}, vegan: {} },
  };
  MODES.forEach(m => LIST_KEYS.forEach(k => { mem.lists[m][k] = []; }));
  mergeLists(mem, saved);
  return mem;
}

let memory = normalize(null);
let tab = 'vegetarian';

async function load() {
  memory = normalize((await chrome.storage.local.get(KEY))[KEY]);
}

async function save(statusEl, message) {
  try {
    await chrome.storage.local.set({ [KEY]: memory });
    if (statusEl) show(statusEl, message);
    return true;
  } catch (e) {
    if (statusEl) show(statusEl, "Couldn't save: " + e.message, true);
    return false;
  }
}

function show(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('err', isError);
}

function renderSettings() {
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === memory.mode)));
  document.querySelectorAll('[data-action]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.action === memory.action)));
}

function renderLists() {
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-list]').forEach(box => {
    const key = box.dataset.list;
    const values = memory.lists[tab][key];
    box.replaceChildren();
    if (!values.length) {
      const empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = 'None yet';
      box.append(empty);
      return;
    }
    values.forEach(value => {
      const item = document.createElement('span');
      item.className = 'item';
      const label = document.createElement('span');
      label.textContent = value; // product names come from shop pages: text only, never HTML
      const remove = document.createElement('button');
      remove.textContent = '×';
      remove.title = 'Remove';
      remove.setAttribute('aria-label', `Remove ${value}`);
      remove.onclick = async () => {
        memory.lists[tab][key] = memory.lists[tab][key].filter(v => v !== value);
        await save();
        renderLists();
      };
      item.append(label, remove);
      box.append(item);
    });
  });
}

async function renderSites() {
  const sites = await getUserSites();
  $('sitesSection').hidden = sites.length === 0;
  const box = $('sites');
  box.replaceChildren();
  sites.forEach(origin => {
    const item = document.createElement('span');
    item.className = 'item';
    const label = document.createElement('span');
    label.textContent = new URL(origin).host;
    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = 'Stop running automatically here';
    remove.onclick = async () => {
      await chrome.runtime.sendMessage({ type: 'vf-remove-site', url: origin + '/' });
      try {
        await chrome.permissions.remove({ origins: [origin + '/*'] });
      } catch (e) {}
      renderSites();
    };
    item.append(label, remove);
    box.append(item);
  });
}

function renderAll() {
  renderSettings();
  renderLists();
}

// ---------- events ----------
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', async () => {
  memory.mode = b.dataset.mode;
  tab = memory.mode;
  await save($('settingsStatus'), '✓ Saved');
  renderAll();
}));
document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', async () => {
  memory.action = b.dataset.action;
  await save($('settingsStatus'), '✓ Saved');
  renderSettings();
}));
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  renderLists();
}));

let confirmReset = false;
$('reset').onclick = async () => {
  if (!confirmReset) {
    confirmReset = true;
    $('reset').textContent = `⚠️ Click again to wipe the ${tab === 'vegan' ? 'Vegan' : 'Vegetarian'} list`;
    return;
  }
  confirmReset = false;
  $('reset').textContent = "Reset this mode's list";
  LIST_KEYS.forEach(k => { memory.lists[tab][k] = []; });
  await save();
  renderLists();
};

$('export').onclick = () => {
  const payload = { version: 2, exportedAt: new Date().toISOString(), mode: memory.mode, action: memory.action, lists: memory.lists };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `herbivore-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  show($('backupStatus'), '✅ Backup downloaded.');
};

$('import').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2_000_000) return show($('backupStatus'), '❌ That file is too big to be a Herbivore backup.', true);
  try {
    const imported = JSON.parse(await file.text());
    if (!imported || typeof imported !== 'object') throw new Error('not a backup');
    mergeLists(memory, imported);
    if (MODES.includes(imported.mode)) memory.mode = imported.mode;
    if (imported.action === 'dim' || imported.action === 'hide') memory.action = imported.action;
    const ok = await save();
    tab = memory.mode;
    renderAll();
    show($('backupStatus'), ok ? '✅ Backup merged in.' : "❌ Couldn't save the imported backup.", !ok);
  } catch (err) {
    show($('backupStatus'), '❌ That file isn\'t a valid Herbivore backup.', true);
  }
};

// Keep in step with changes made from shop tabs
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes[KEY]) {
    memory = normalize(changes[KEY].newValue);
    renderAll();
  }
  if (changes[SITES_KEY]) renderSites();
});

// ---------- start ----------
const welcome = new URLSearchParams(location.search).get('welcome') === '1';
$('welcome').hidden = !welcome;
$('helpIntro').hidden = welcome;
if (welcome) document.title = 'Welcome to Herbivore';
await load();
tab = memory.mode;
renderAll();
renderSites();

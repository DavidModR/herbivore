import { originOf, isBuiltIn, getUserSites, runOnTab } from './sites.js';

// Opened two ways: as the toolbar panel (acts on the active tab, and starts filtering it), or
// as a small window from the widget's "📌 Always run here" button (?tabId=…&mode=window).
const params = new URLSearchParams(location.search);
const windowMode = params.get('mode') === 'window';

const $ = (id) => document.getElementById(id);
// Any web page can be filtered once (toolbar click); only https sites can be saved
const canRun = (url) => /^https?:\/\//i.test(url || '');

// tab.url needs the "tabs" permission (which shows a "read your browsing history" warning) OR
// access to that tab: opening this panel from the toolbar icon grants it for the active tab
// (activeTab), and the window mode only opens for tabs Herbivore already runs on. If the URL
// still isn't available, the panel just says it can't run there.
async function targetTab() {
  if (params.get('tabId')) return chrome.tabs.get(Number(params.get('tabId')));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render(tab) {
  const origin = originOf(tab.url);
  $('site').textContent = canRun(tab.url) ? new URL(tab.url).host : '';
  $('always').hidden = true;
  $('stop').hidden = true;

  if (!canRun(tab.url)) {
    $('status').textContent = "Herbivore can't run on this page.";
    $('note').hidden = true;
    return;
  }
  if (!origin) {
    $('status').textContent = 'Filtering is on for this tab. "Always run" needs a secure (https) site.';
    $('note').hidden = true;
    return;
  }
  if (isBuiltIn(tab.url)) {
    $('status').textContent = /(^|\.)amazon\./.test(new URL(origin).host)
      ? '✅ Runs automatically on Amazon grocery & Fresh pages. Filtering is on for this tab now too.'
      : '✅ Runs automatically on this shop.';
    $('note').hidden = true;
    return;
  }
  const saved = (await getUserSites()).includes(origin);
  const granted = await chrome.permissions.contains({ origins: [origin + '/*'] });
  if (saved && granted) {
    $('status').textContent = '✅ Runs automatically on this site (added by you).';
    $('stop').hidden = false;
    $('note').hidden = true;
  } else {
    $('status').textContent = windowMode
      ? 'Filtering is on for this tab until it reloads.'
      : 'Filtering is on for this tab until it reloads. Want it every time?';
    $('always').textContent = `📌 Always run on ${new URL(origin).host}`;
    $('always').hidden = false;
    $('note').hidden = false;
  }
}

async function main() {
  const tab = await targetTab().catch(() => null); // e.g. the shop tab was closed meanwhile
  if (!tab) {
    $('status').textContent = 'That tab has been closed.';
    $('note').hidden = true;
    return;
  }

  // Toolbar click: start filtering this tab straight away (activeTab gives access to it)
  if (!windowMode && canRun(tab.url)) {
    try {
      await runOnTab(tab.id);
    } catch (e) {
      $('status').textContent = "Herbivore can't run on this page.";
      return;
    }
  }
  await render(tab);

  $('always').onclick = async () => {
    const origin = originOf(tab.url);
    // Must be called straight from the click. If this panel closes while Chrome's prompt is
    // showing, the background script still registers the site when access is granted.
    const ok = await chrome.permissions.request({ origins: [origin + '/*'] });
    if (!ok) {
      $('status').textContent = 'Not allowed: filtering stays on for this tab only.';
      return;
    }
    await chrome.runtime.sendMessage({ type: 'vf-add-site', url: tab.url });
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'vf-site-saved' });
    } catch (e) {} // the tab has no widget (e.g. it was reloaded): nothing to update
    await render(tab);
    if (windowMode) setTimeout(() => window.close(), 1200);
  };

  $('stop').onclick = async () => {
    const origin = originOf(tab.url);
    await chrome.runtime.sendMessage({ type: 'vf-remove-site', url: tab.url });
    try {
      await chrome.permissions.remove({ origins: [origin + '/*'] });
    } catch (e) {} // already removed in chrome://extensions
    await render(tab);
  };
}

$('help').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
  window.close();
};

main();

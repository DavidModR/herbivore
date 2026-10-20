import { addSite, removeSite, syncSites, originOf } from './sites.js';

// Site access granted / removed (from the toolbar panel, or in chrome://extensions)
const originsIn = (perms) => (perms.origins || [])
  .map(o => o.replace(/\/\*$/, ''))
  .filter(o => /^https:\/\/[^*]+$/.test(o));

chrome.permissions.onAdded.addListener(perms => originsIn(perms).forEach(addSite));
chrome.permissions.onRemoved.addListener(perms => originsIn(perms).forEach(removeSite));

const safeSync = async () => {
  try {
    await syncSites();
  } catch (e) {
    console.warn('Herbivore: could not sync added sites', e);
  }
};
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await safeSync();
  // First install: open the Help page in welcome mode (choose Veggie or Vegan, Blur or Hide)
  if (reason === 'install') {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('help.html?welcome=1') });
    } catch (e) {
      console.warn('Herbivore: could not open the welcome page', e);
    }
  }
});
chrome.runtime.onStartup.addListener(safeSync);

// One "Always run" panel window per tab at a time. Kept in session storage, not a variable:
// this background script is stopped when idle, and a variable would be lost.
const PANELS_KEY = 'vf_open_panels';
const getPanels = async () => (await chrome.storage.session.get(PANELS_KEY))[PANELS_KEY] || {};
const setPanels = (panels) => chrome.storage.session.set({ [PANELS_KEY]: panels });

chrome.windows.onRemoved.addListener(async (windowId) => {
  const panels = await getPanels();
  for (const [tabId, id] of Object.entries(panels)) if (id === windowId) delete panels[tabId];
  await setPanels(panels);
});

async function openSitePanel(tabId) {
  const panels = await getPanels();
  if (panels[tabId]) {
    try {
      await chrome.windows.update(panels[tabId], { focused: true });
      return;
    } catch (e) {
      // that window is gone: open a new one
    }
  }
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(`popup.html?tabId=${tabId}&mode=window`),
      type: 'popup',
      width: 360,
      height: 300,
    });
    await setPanels({ ...(await getPanels()), [tabId]: win.id });
  } catch (e) {
    console.warn('Herbivore: could not open the site panel', e);
  }
}

// Our own extension pages: the toolbar panel and the Help & memory page
const fromOurPanel = (sender) =>
  sender.id === chrome.runtime.id &&
  ['popup.html', 'help.html'].some(page => (sender.url || '').startsWith(chrome.runtime.getURL(page)));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  // Widget's "📌 Always run here" button (a content script): Chrome only lets an extension page
  // ask for site access, so open the toolbar panel in a small window for that tab
  if (msg?.type === 'vf-open-site-panel' && sender.tab?.id && originOf(sender.url)) {
    openSitePanel(sender.tab.id);
    return;
  }

  // Widget's "?" and the Memory panel's "📖 Full page": open the Help & memory page
  if (msg?.type === 'vf-open-help') {
    (async () => {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
      } catch (e) {
        console.warn('Herbivore: could not open the help page', e);
      }
    })();
    return;
  }

  // Adding or removing a site: only our own panel may ask, never a content script
  if ((msg?.type === 'vf-add-site' || msg?.type === 'vf-remove-site') && fromOurPanel(sender)) {
    (async () => {
      try {
        await (msg.type === 'vf-add-site' ? addSite : removeSite)(originOf(msg.url));
      } finally {
        sendResponse(true);
      }
    })();
    return true; // keeps the channel open for the async reply
  }
});

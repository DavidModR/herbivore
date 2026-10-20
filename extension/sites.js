// Sites the user chose to "always run" on (beyond the built-in shops), shared by the
// background script and the toolbar panel.

export const SITES_KEY = 'vf_user_sites_v1';

// https only: a plain-http page can be rewritten by anyone on the same network (public Wi-Fi)
export const originOf = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch (e) {
    return null;
  }
};

// Built-in shops come from manifest.json's content_scripts matches
const builtInPatterns = () => chrome.runtime.getManifest().content_scripts.flatMap(c => c.matches);
const patternToRegex = (p) => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
export const isBuiltIn = (url) => builtInPatterns().some(p => patternToRegex(p).test(url));

// Hex-encoded, so two different sites can never share an ID (a-b.com vs a_b.com)
export const scriptIdFor = (origin) => 'vf-site-' + [...new TextEncoder().encode(origin)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function getUserSites() {
  const res = await chrome.storage.local.get(SITES_KEY);
  return res[SITES_KEY] || [];
}

async function setUserSites(sites) {
  await chrome.storage.local.set({ [SITES_KEY]: [...new Set(sites)].sort() });
}

async function isRegistered(origin) {
  const found = await chrome.scripting.getRegisteredContentScripts({ ids: [scriptIdFor(origin)] });
  return found.length > 0;
}

// Changes run one at a time: the permission event and the panel's message both add the same
// site, and two registrations at once would fail with "duplicate script ID"
// (The queue is only an in-flight lock for changes happening right now, not saved state.)
let queue = Promise.resolve();
const queued = (fn) => (...args) => {
  const run = async () => {
    await queue.catch(() => {});
    try {
      await fn(...args);
    } catch (e) {
      console.warn('Herbivore: site change failed', e);
    }
  };
  queue = run();
  return queue;
};

// Only for sites the user has granted access to in Chrome's prompt
export const addSite = queued(async (origin) => {
  if (!origin || isBuiltIn(origin + '/')) return;
  if (!(await chrome.permissions.contains({ origins: [origin + '/*'] }))) return;
  await setUserSites([...(await getUserSites()), origin]);
  if (!(await isRegistered(origin))) {
    await chrome.scripting.registerContentScripts([{
      id: scriptIdFor(origin),
      matches: [origin + '/*'],
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
  }
});

export const removeSite = queued(async (origin) => {
  if (!origin) return;
  await setUserSites((await getUserSites()).filter(o => o !== origin));
  if (await isRegistered(origin)) {
    await chrome.scripting.unregisterContentScripts({ ids: [scriptIdFor(origin)] });
  }
});

// Keep the saved list, Chrome's granted permissions and the registered scripts in step
// (e.g. after the user removes a site's access in chrome://extensions)
export async function syncSites() {
  const sites = await getUserSites();
  for (const origin of sites) {
    const granted = await chrome.permissions.contains({ origins: [origin + '/*'] });
    if (granted) await addSite(origin);
    else await removeSite(origin);
  }
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const wanted = new Set((await getUserSites()).map(scriptIdFor));
  const stale = registered.map(s => s.id).filter(id => id.startsWith('vf-site-') && !wanted.has(id));
  if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
}

// Start filtering on a tab now (or bring its widget back if already running)
export async function runOnTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      if (typeof window.__vfShow === 'function') {
        window.__vfShow();
        return 'shown';
      }
      window.__vfForce = true;
      return 'inject';
    },
  });
  if (result === 'inject') {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

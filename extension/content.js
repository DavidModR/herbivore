(() => {
  // 0. Should we run here?
  // - Pasted in the console, or the toolbar icon was clicked (window.__vfForce): always.
  // - Extension on a listed shop: always, except Amazon, where only grocery pages count.
  const isExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;
  const forced = !isExtension || window.__vfForce === true;
  window.__vfForce = false;

  // Amazon grocery / Amazon Fresh: search department, URL, or category bar says grocery
  function isAmazonGrocery() {
    const url = location.href.toLowerCase();
    if (/[?&]i=(grocery|amazonfresh|fresh)\b|search-alias(=|%3d)(grocery|amazonfresh)|\/alm\/|almbrandid|\/fresh\b|340834031/.test(url)) return true;
    const dept = document.getElementById('searchDropdownBox');
    if (dept && /grocery|amazonfresh/i.test(dept.value)) return true;
    const subnav = document.getElementById('nav-subnav');
    if (subnav && /grocery|fresh/i.test(subnav.getAttribute('data-category') || '')) return true;
    const crumbs = document.getElementById('wayfinding-breadcrumbs_feature_div');
    return !!crumbs && /grocery|fresh/i.test(crumbs.textContent);
  }
  const isAmazon = /(^|\.)amazon\./i.test(location.hostname);
  // Amazon pages that aren't clearly grocery (All Departments searches, product pages, the
  // homepage…) still run, but only check tiles priced per kg / 100 g / litre: only groceries
  // show that, so books or electronics are never touched (and the widget stays hidden there).
  const amazonUnitPriceOnly = isAmazon && !forced && !isAmazonGrocery();
  const UNIT_PRICE_REGEX = /£\s?\d+(?:\.\d+)?\s?\/\s?(?:kg|kilo|\d*\s?g|\d*\s?ml|l|litre|liter|\d*\s?cl)\b|\bper (?:kg|kilo|100\s?g|litre|100\s?ml)\b/i;

  // 1. Clean up previous instance
  if (typeof window.__vfTeardown === 'function') window.__vfTeardown();
  if (window.__vfObserver) window.__vfObserver.disconnect();
  if (window.__vfClickHandler) document.removeEventListener('click', window.__vfClickHandler, true);
  ['vf-floating-ui', 'vf-pill', 'vf-toast-ui', 'vf-memory-modal', 'vf-styles'].forEach(id => document.getElementById(id)?.remove());
  document.querySelectorAll('veggiefilter-ui').forEach(el => el.remove());
  document.querySelectorAll('[data-vf-scanned]').forEach(el => {
    ['data-vf-scanned', 'data-vf-blocked', 'data-vf-maybe', 'data-vf-action', 'data-vf-reason', 'data-vf-title', 'data-vf-diet', 'data-vf-pos'].forEach(a => el.removeAttribute(a));
  });
  document.querySelectorAll('.vf-override-btn, .vf-ok-btn, .vf-badge').forEach(b => b.remove());

  let active = true;
  let debounceTimer = null;

  // 2. Hybrid Storage (Works in DevTools Console AND Chrome Extension)
  const STORAGE_KEY = 'vf_user_memory_v1';
  const MODES = ['vegetarian', 'vegan'];
  const LIST_KEYS = ['blockedProducts', 'allowedProducts', 'customBlockedWords'];

  // Each mode keeps its own flags, so a veggie and a vegan can share one browser:
  //   blockedProducts    - exact product titles flagged by user
  //   allowedProducts    - exact product titles undimmed by user
  //   customBlockedWords - keywords user chose to block across all items
  const emptyLists = () => ({ blockedProducts: [], allowedProducts: [], customBlockedWords: [] });
  // Lists only ever hold short, lower-case, trimmed strings (also guards imported backups:
  // an empty keyword would match every product, and huge lists would slow every scan)
  const MAX_LIST = 5000;
  const cleanList = (arr) => [...new Set(arr
    .filter(v => typeof v === 'string')
    .map(v => v.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(v => v.length >= 2 && v.length <= 300))].slice(0, MAX_LIST);

  // Accepts current (per-mode) data or older flat data. Flat lists don't say which mode they
  // were made in, so they're copied into both modes (nothing previously flagged gets lost).
  function normalizeMemory(saved) {
    const mem = {
      mode: MODES.includes(saved?.mode) ? saved.mode : 'vegetarian', // 'vegetarian' | 'vegan'
      action: saved?.action === 'hide' ? 'hide' : 'dim',            // 'dim' (shown as Blur, the default) | 'hide'
      minimised: saved?.minimised === true,                          // widget shrunk to a pill
      lists: { vegetarian: emptyLists(), vegan: emptyLists() }
    };
    mergeLists(mem, saved);
    return mem;
  }

  function mergeLists(mem, src) {
    if (!src) return;
    MODES.forEach(m => LIST_KEYS.forEach(k => {
      const fromMode = src.lists?.[m]?.[k];
      const fromFlat = src[k];
      const incoming = [...(Array.isArray(fromMode) ? fromMode : []), ...(Array.isArray(fromFlat) ? fromFlat : [])];
      mem.lists[m][k] = cleanList([...mem.lists[m][k], ...incoming]);
    }));
  }

  // The lists for whichever mode is currently selected
  const lists = () => memory.lists[memory.mode];

  let memory = normalizeMemory(null);
  const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;

  // Console version: memory lives in this site's localStorage.
  // Extension: memory lives in chrome.storage, shared by every shop and tab. The site's
  // localStorage is only read once, to bring across flags made with the console version.
  function readLocalMemory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  // Resolves true if saved. A failed save (e.g. storage full) is shown to the user, so flags
  // never silently go missing.
  function saveMemory() {
    const failed = () => {
      showInfoToast("⚠️ Couldn't save your settings. Try exporting a backup and resetting memory.");
      return false;
    };
    return (async () => {
      try {
        if (hasChromeStorage) await chrome.storage.local.set({ [STORAGE_KEY]: memory });
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
        return true;
      } catch (e) {
        // storage full, or the extension was reloaded while this tab stayed open
        return failed();
      }
    })();
  }

  const MIGRATED_KEY = 'vf_console_migrated_v1';
  // Pages from manifest.json's built-in shop list, minus Amazon
  function onBuiltInSupermarket() {
    try {
      const patterns = chrome.runtime.getManifest().content_scripts.flatMap(c => c.matches);
      const toRegex = (p) => new RegExp('^' + p.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      return !isAmazon && patterns.some(p => toRegex(p).test(location.href));
    } catch (e) {
      return false;
    }
  }

  // Another tab (or shop) changed memory: pick it up here too
  function onStorageChanged(changes, area) {
    const next = changes[STORAGE_KEY]?.newValue;
    if (!active || area !== 'local' || !next) return;
    if (JSON.stringify(next) === JSON.stringify(memory)) return; // our own save
    memory = normalizeMemory(next);
    updateControlBarUI();
    scanPage(true);
    if (ui$('vf-memory-modal')) renderMemoryModal();
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 3. Bulletproof CSS (Works across Search Grids, Veggie Tabs, and Carousels)
  const styleEl = document.createElement('style');
  styleEl.id = 'vf-styles';
  styleEl.textContent = `
    /* No isolation / stacking context on tiles: that traps the site's own menus and popups
       underneath later content. Our buttons use small z-indexes instead, so any site menu or
       popup (z-index 10+) still draws over them.
       Only tiles that had no positioning get "relative" (so our buttons can sit on them);
       carousel slides etc. that are already absolute/sticky are left alone */
    [data-vf-pos="1"] {
      position: relative !important;
    }

    /* "Blur": the product photo is blurred and greyed so it can't tempt you, and stays that way
       on hover (only the text gets easier to read). clip-path keeps the blur inside the photo. */
    [data-vf-blocked="true"][data-vf-action="dim"] img,
    [data-vf-blocked="true"][data-vf-action="dim"] picture,
    [data-vf-blocked="true"][data-vf-action="dim"] video,
    [data-vf-blocked="true"][data-vf-action="dim"] [style*="background-image"] {
      filter: blur(16px) grayscale(100%) !important;
      clip-path: inset(0) !important;
    }
    [data-vf-blocked="true"][data-vf-action="dim"] > *:not(.vf-override-btn):not(.vf-badge) {
      opacity: 0.4 !important;
      transition: opacity 0.2s ease !important;
    }
    [data-vf-blocked="true"][data-vf-action="dim"]:hover > *:not(.vf-override-btn):not(.vf-badge) {
      opacity: 0.7 !important;
    }

    [data-vf-blocked="true"][data-vf-action="hide"] {
      display: none !important;
    }

    /* Reason badge: second row, under the buttons, so it never hides behind them on narrow tiles.
       A real element rather than ::after, so it can't clash with the site's own ::after overlays. */
    .vf-badge {
      position: absolute !important;
      top: 34px !important;
      left: 8px !important;
      z-index: 2 !important;
      background: #991b1b !important;
      color: #fff !important;
      font-family: sans-serif !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      padding: 4px 8px !important;
      border-radius: 6px !important;
      pointer-events: none !important;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35) !important;
      max-width: calc(100% - 16px) !important;
      box-sizing: border-box !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    /* ❓ "Maybe" badge: amber, card stays fully visible */
    .vf-badge.vf-badge--maybe {
      background: #b45309 !important;
    }

    /* Minimised widget pill */
    #vf-pill {
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: #0f172a; color: #34d399; border: 1px solid #334155; border-radius: 999px;
      padding: 7px 12px; font: 700 12px sans-serif; cursor: pointer;
      box-shadow: 0 6px 18px rgba(0,0,0,0.4);
    }
    #vf-pill:hover { border-color: #34d399; }

    /* Top-Left Flag / Undim Button, plus "Looks fine" top-right on ❓ cards */
    .vf-override-btn, .vf-ok-btn {
      position: absolute !important;
      top: 8px !important;
      left: 8px !important;
      z-index: 3 !important;
      border: 1px solid rgba(15, 23, 42, 0.25) !important;
      border-radius: 6px !important;
      padding: 4px 9px !important;
      font-family: sans-serif !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      pointer-events: auto !important;
      transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.25) !important;
      line-height: 1.2 !important;
    }

    [data-vf-blocked="false"] .vf-override-btn {
      opacity: 0;
      background: rgba(15, 23, 42, 0.9);
      color: #fca5a5;
    }
    [data-vf-blocked="false"]:hover .vf-override-btn,
    [data-vf-maybe="true"] .vf-override-btn {
      opacity: 1;
    }

    .vf-ok-btn {
      left: auto !important;
      right: 8px !important;
      top: 8px !important;
      background: #065f46 !important;
      color: #ecfdf5 !important;
      border-color: #10b981 !important;
    }
    .vf-ok-btn:hover {
      background: #10b981 !important;
      color: #022c22 !important;
    }
    [data-vf-blocked="false"] .vf-override-btn:hover {
      background: #991b1b !important;
      color: #ffffff !important;
    }

    /* Always 100% visible on dimmed items */
    [data-vf-blocked="true"] .vf-override-btn {
      opacity: 1 !important;
      filter: none !important;
      background: #065f46 !important;
      color: #ecfdf5 !important;
      border-color: #10b981 !important;
    }
    [data-vf-blocked="true"] .vf-override-btn:hover {
      background: #10b981 !important;
      color: #022c22 !important;
      transform: scale(1.04);
    }

    .vf-mem-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #1e293b;
      border: 1px solid #334155;
      padding: 2px 7px;
      border-radius: 5px;
      font-size: 11px;
      margin: 2px;
      cursor: pointer;
    }
    .vf-mem-pill:hover {
      border-color: #ef4444;
      background: #450a0a;
    }

  `;
  document.head.appendChild(styleEl);

  // Our widget, pill, toast and Memory panel live in a CLOSED shadow root: the shop's own
  // scripts (and any ad/analytics script on the page) can't read it (your flags, your diet),
  // click it, rewrite its links or reach the backup file input. A custom tag name keeps page
  // CSS like "div { … }" off the host.
  const uiHost = document.createElement('veggiefilter-ui');
  uiHost.style.cssText = 'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; z-index: 2147483646 !important;';
  const uiRoot = uiHost.attachShadow({ mode: 'closed' });
  const uiStyle = document.createElement('style');
  uiStyle.textContent = styleEl.textContent;
  uiRoot.appendChild(uiStyle);
  const ui$ = (id) => uiRoot.getElementById(id);
  // Belt and braces: ignore any click inside our UI that wasn't made by a real person
  uiRoot.addEventListener('click', (e) => {
    if (!e.isTrusted) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  // Pop-ups and the Memory panel sit just above the widget (or the minimised pill), whatever
  // its height, so they never cover its buttons
  function aboveWidget() {
    const full = ui$('vf-floating-ui');
    const pill = ui$('vf-pill');
    const el = full && full.style.display !== 'none' ? full : pill && pill.style.display !== 'none' ? pill : null;
    return el ? Math.round(el.getBoundingClientRect().height) + 20 + 10 : 20;
  }

  function showInfoToast(message) {
    ui$('vf-info-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'vf-info-toast';
    t.style.cssText = `position:fixed;bottom:${aboveWidget()}px;right:20px;z-index:999999;background:#1e293b;color:#f8fafc;padding:10px 14px;border-radius:10px;font:12px sans-serif;box-shadow:0 10px 25px rgba(0,0,0,0.45);border:1px solid #475569;max-width:320px;`;
    t.textContent = message;
    uiRoot.appendChild(t);
    setTimeout(() => t.remove(), 7000);
  }

  // 4. Split Heuristics: Safe Compounds, Vegan Modifiers vs Veggie Modifiers, Meat, and Expanded Dairy/Chocolate
  const SAFE_REGEX = /\b(peanut butter|almond butter|cashew butter|hazelnut butter|pistachio butter|seed butter|sunflower butter|cocoa butter|shea butter|butternut squash|butternut|crown prince|butter beans?|butterhead|coconut milk|oat milk|soya? milk|almond milk|cashew milk|pea milk|hemp milk|rice milk|coconut cream|oat cream|soya? cream|(?:oat|soya?|coconut|almond|cashew) cr[eè]me|vegan cheese|coconut yog(?:h?urt)|oat yog(?:h?urt)|soya? yog(?:h?urt)|vegan chocolate|plant[- ]based chocolate|dairy[- ]free chocolate|dark chocolate|raw chocolate|beef(?:steak)? tomato(?:es)?|oyster mushrooms?|king oyster|hen of the woods|lion's mane|eggplants?|aubergines?|chickpeas?|jackfruits?|breadfruits?|cream of tartar|cream soda|lactic acid|mince pies?|sweetmeats?|fruit mince|mincemeat|nut roasts?|eggshells?|easter egg|cream crackers?|lamb'?s lettuce|vegetable suet|kidney beans?|pigeon peas|chicken of the woods|mock (?:duck|chicken)|crab apples?|artichoke hearts?|hearts? of palm|lambrusco|sole meuni[eè]re sauce|meat[- ]?free|meatless|fish[- ]?free|(?:cauliflower|celeriac|mushroom|aubergine) steaks?)\b/gi;

  // Strictly Vegan modifiers (excuses both Meat AND Dairy lookalike words like "Vegan Cheese" or "Plant Butter")
  const VEGAN_MOD_REGEX = /\b(vegan|plant[- ]based|plant pioneers|plant chef|dairy[- ]free|milk[- ]free|egg[- ]free|this isn't|beyond meat|vivera|squeaky bean|tofoo|oomph|moving mountains|bosh!|wicked kitchen|alpro|oatly|violife|applewood vegan|cathedral city plant|philadelphia plant|flora plant|lurpak plant|babybel plant|nurishh|koko|plenty|nomo|hip chocolate|plant bar|galaxy vegan|kitkat v|love raw|buttermilk plant|elmlea plant|califia|rude health|innocentplus|plenish|mighty pea|sproud|minor figures|follow your heart|sheese|cauldron vegan|quorn vegan|linda mccartney vegan|richmond vegan|vegetarian butcher|fish[- ]free|fishless|no[- ]fish)\b/i;

  // Vegetarian-only modifiers (excuses Meat lookalikes like "Vegetarian Sausages", but NEVER excuses Dairy/Butter/Chocolate in Vegan mode!)
  const VEGGIE_MOD_REGEX = /\b(vegetarian|veggie|meat[- ]free|meatless|quorn|cauldron|linda mccartney|fry's|no[- ](?:beef|chicken|pork|fish|duck|lamb|meat|turkey)|not[- ]chicken|isn't (?:bacon|chicken|pork|beef)|without the oink)\b/i;

  // Meat, fish & animal-derived words. Grouped so the list is easy to extend. Each entry is a
  // regex fragment; the whole list is matched as whole words. Words that also name veggie
  // foods carry their exceptions inline (kidney beans, buffalo mozzarella, goat's cheese, duck
  // eggs…). Vegan/vegetarian modifiers ("Quorn", "meat-free", "vegan") still excuse a match.
  const MEAT_TERMS = [
    // farm animals & meats
    'beef', 'veal', 'pork', '(?<!peppa )pigs?', 'piglet', 'suckling pig', 'lamb', 'lambs', 'hogget', 'mutton',
    'goat(?!\'?s? (?:cheese|milk|butter|yog(?:h)?urt|curd|kefir|cream))', 'kid goat', 'horse meat', 'horsemeat',
    'meat', 'meats', 'red meat', 'cold cuts', 'deli meats?', 'charcuterie', 'carvery',
    // poultry & game
    'chicken', 'chickens', 'poultry', 'poussin', 'cockerel', 'capon', 'hen(?! of the woods)(?=s? (?:whole|crown|breast|thigh|leg))',
    'turkey', 'turkeys', 'turducken', 'duck(?! eggs?)', 'ducks', 'duckling', 'goose(?! eggs?)', 'guinea ?fowl',
    'quail(?! eggs?)', 'pigeon(?! peas)', 'squab', 'partridge', 'pheasant', 'grouse', 'woodcock', 'snipe', 'game bird',
    'venison', 'deer', 'elk', 'reindeer', 'moose', 'wild boar', 'boar', 'bison', 'buffalo(?! mozzarella| cauliflower| sauce| style sauce)',
    'rabbit', 'hare', 'ostrich', 'emu', 'kangaroo', 'crocodile', 'alligator', 'frog\'?s? legs', 'snails', 'escargots?',
    // breeds & butchery wording
    'wagyu', 'kobe', 'angus', 'aberdeen angus', '(?:hereford|longhorn|dexter|galloway|highland|belted galloway) beef',
    'gloucester old spot', '(?:tamworth|saddleback|berkshire) pork', 'duroc', 'mangalitza', 'iberico', 'ib[eé]rico', 'herdwick', 'texel lamb',
    'salt marsh lamb', 'grass[- ]fed beef', 'dry[- ]aged', '\\d+[- ]days? (?:dry[- ])?(?:aged|matured|hung)',
    'on the bone', 'bone[- ]in', 'boneless', 'de-?boned', '\\d+[- ]bone', 'spatchcock(?:ed)?', 'butterflied',
    'whole bird', 'carcass', 'jointed', 'butcher\'?s', 'butchers',
    // cuts
    'steaks?', 'sirloin', 'ribeye', 'rib[- ]eye', 'rump', 'fillet steak', 't-bone', 'porterhouse', 'tomahawk', 'picanha',
    'bavette', 'flank', 'skirt steak', 'onglet', 'chateaubriand', 'tenderloin', 'loin', 'brisket', 'chuck', 'topside',
    'silverside', 'beef shin', 'shin of beef', 'shank', 'shanks', 'ribs?', 'short ribs', 'spare ?ribs', 'prime rib', 'fore ?rib', 'rib roast',
    'rack of', 'shoulder', 'belly(?! button)(?<!jelly belly)', 'hock', 'hocks', 'trotters', 'knuckle', 'cheeks',
    'chops', 'cutlets', 'escalopes?', 'medallions', 'schnitzels?', 'cordon bleu', 'mince',
    'drumsticks?(?! (?:lolly|lollies|squashies|chews?|sweets))', 'thighs', 'breast fillets?', '(?<!cauliflower |vegan |plant |veggie )wings',
    // offal & fats
    'offal', 'liver', 'livers', 'kidneys?(?! beans?)', 'tongue', 'tripe', 'sweetbreads', 'giblets', 'brains',
    'chitterlings', 'bone marrow', 'marrow ?bones?', 'bones', 'bone broth', 'oxtail', 'oxtails',
    'suet', 'lard', 'dripping', 'tallow', 'schmaltz', 'crackling', 'scratchings',
    // charcuterie, sausages & cured
    'bacon', 'ham', 'hams', 'gammon', 'prosciutto', 'parma ham', 'serrano', 'jam[oó]n', 'pancetta', 'guanciale', 'lardo',
    'lardons', 'coppa', 'capocollo', 'bresaola', 'speck', 'salami', 'salame', 'chorizo', 'sobrasada', 'nduja', 'pepperoni',
    'saucisson', 'mortadella', 'porchetta', 'lambchetta', 'porkchetta', 'salchich[oó]n', 'fuet', 'kabanos', 'kielbasa',
    'cabanossi', 'bratwurst', 'frankfurters?', 'wieners?', 'knackwurst', 'bockwurst', 'weisswurst', 'currywurst',
    'merguez', 'boerewors', 'toulouse sausages?', 'sausages?', 'sausagemeat', 'chipolatas?', 'black pudding', 'white pudding',
    'haggis', 'faggots', 'terrine', 'rillettes', 'foie gras', 'liverwurst', 'brawn', 'corned', 'pastrami', 'salt beef',
    'biltong', 'jerky', 'spam', 'luncheon meat', 'hot ?dogs?(?! rolls| buns)', 'meatballs?', 'meatloaf', 'scotch eggs?',
    'pigs? in (?:blankets?|duvets?)', 'hog', 'hog roast', 'outdoor (?:bred|reared)', 'turkey crown', 'three bird roast',
    // dishes that are (almost always) meat or fish
    'cottage pie', 'shepherd\'?s pie', 'cornish pasty', 'cornish pasties', 'bourguignon', 'coq au vin', 'cassoulet',
    'chilli con carne', 'carne', 'carbonara', 'char siu', 'bulgogi', 'souvlaki', 'gyros', 'tonkotsu', 'quarter pounders?',
    'kedgeree', 'paella marinera', 'surf (?:and|&) turf',
    // fish & seafood
    'fish', 'fishes', 'seafood', 'fishcakes?', 'fish fingers', 'fish pie', 'fish sauce', 'salmon', 'trout', 'tuna', 'cod',
    'haddock', 'hake', 'pollock', 'pollack', 'coley', 'plaice', '(?:lemon|dover|megrim) sole', 'sole fillets?', 'sole meuni[eè]re', 'halibut', 'turbot', 'brill', 'monkfish',
    'sea ?bass', 'sea ?bream', 'bream', 'snapper', 'mackerel', 'herring', 'herrings', 'rollmops', 'kippers?', 'sardines?',
    'pilchards?', 'anchov(?:y|ies)', 'sprats', 'whitebait', 'swordfish', 'marlin', 'mahi[- ]?mahi', 'tilapia', 'basa',
    'pangasius', 'catfish', 'carp', 'pike', 'eels?', 'skate', 'shark', 'gurnard', 'john dory', 'mullet', 'grouper',
    'barramundi', 'kingfish', 'bonito', 'roe', 'caviar', 'taramasalata', 'surimi', 'crab(?! apples?)', 'crabs',
    'crab ?sticks', 'lobsters?', 'langoustines?', 'scampi', 'prawns?', 'shrimps?', 'crayfish', 'mussels?', 'clams?',
    'cockles', 'whelks', 'winkles', 'oysters?(?! mushrooms?)', 'scallops?', 'squid', 'calamari', 'octopus', 'cuttlefish',
    'sea urchin', 'gravad ?lax', 'gravlax', 'lox', 'sashimi', 'dashi', 'katsuobushi', 'oyster sauce',
    // gelatine & other animal-derived ingredients
    'gelatine?', 'gelatin', 'collagen', 'isinglass', 'carmine', 'cochineal', 'e120', 'shellac', 'e904', 'animal rennet',
    'crickets', 'mealworms',
    // brands that sell (almost) only meat or fish; their vegan lines are excused by the modifiers
    'young\'?s', 'john west', 'glenryck', 'saupiquet', 'rio mare', 'peperami', 'pepperami', 'mattessons',
    'bernard matthews', 'fridge raiders', 'fray bentos', 'rustlers', 'ye olde oak', 'plumrose', 'heck', 'richmond',
    'gressingham', 'packington', 'donald russell', 'finnebrogue', 'denhay', 'dukeshill', 'musks', 'debbie (?:&|and) andrew\'?s',
    'danish crown', 'dulano', 'kepak', 'gorton\'?s', 'oscar mayer', 'el ?pozo', 'navidul', 'campofr[ií]o', 'citterio',
    'hawksmoor',
  ];
  // (pâté is matched outside the \b group: \b doesn't treat "é" as a word character)
  const MEAT_REGEX = new RegExp(`\\bp[aâ]t[eé](?![a-z])|\\b(?:${MEAT_TERMS.join('|')})\\b`, 'i');

  // Expanded Dairy, Egg, Butter & Chocolate Regex
  const DAIRY_REGEX = /\b(milk|cheese|cheeses|cheesy|chees(?:eboards?|emongers?|eburgers?|estrings?|ecake)|cr[eè]mes?(?! de\b)|cr[eè]me br[uû]l[eé]e|brulee|fromage|fromagerie|fondue|raclette|tartiflette|rice pudding|posset|syllabub|quark|skyr|labneh|reblochon|tomme|taleggio|fontina|provolone|asiago|dolcelatte|jarlsberg|havarti|leerdammer|port salut|boursin|babybel|dairylea|philadelphia|cathedral city|pilgrims choice|shropshire blue|stinking bishop|(?:cornish )?yarg|red fox|colston bassett|baron bigod|chaource|[eé]poisses|vacherin|mont d'or|beaufort|appenzeller|fleur des alpes|affin[eé]|caerphilly|cheshire cheese|lancashire cheese|cheddar|mozzarella|parmesan|parmigiano|grana padano|pecorino|gorgonzola|roquefort|comt[eé]|brie|camembert|feta|halloumi|stilton|gouda|edam|emmental|gruy[eè]re|ricotta|mascarpone|paneer|burrata|manchego|red leicester|wensleydale|double gloucester|lancashire|butter|buttered|buttery|buttermilk|ghee|yoghurts?|yogurts?|fromage frais|kefir|cream|clotted|cr[eè]me fra[iî]che|sour cream|whey|casein|lactose|eggs?|eggy|mayonnaise|mayo|aioli|meringues?|brioche|custard|honey|beeswax|quiche|frittata|omelette|yorkshire puddings?|chocolates?|choc|milk chocolate|white chocolate|chocolatey|nutella|fudge|toffee|caramel|dulce de leche|condensed|evaporated|ice cream|gelato|clotted|lurpak|kerrygold|anchor|country life|clover|utrly butterly|baileys|cappuccino|latte|macchiato|mocha|flat white|croissants?|pain au chocolat|all[- ]butter|shortbread|profiteroles?|eclairs?|tiramisu|cheesecakes?|milkshake|panna cotta|trifle|mousse|dauphinoise|gratin|carbonara|alfredo|lasagne|macaroni cheese|mac\s*&\s*cheese|caesar|ranch|coleslaw|tzatziki|burger sauce|salad cream|tartare|hollandaise|b[eé]arnaise|thousand island|marie rose|hellmann'?s|raita|naan|peshwari|korma|tikka masala|makhani|pasanda|pesto|yule logs?|chocolate logs?|pavlova|stollen|panettone|brandy butter|bread sauce|egg ?nog|advocaat|kit ?kat|twix|snickers|maltesers|galaxy|dairy milk|cadbury|celebrations|heroes|quality street|toblerone|ferrero|rocher|lindor|milky ?bar|milky way|aero|crunchie|wispa|twirl|double decker|yorkie|bounty bars?|m&m'?s|minstrels|revels|rolo|smarties|munchies|terry's|chocolate orange|kinder|freddo|curly wurly|toffee crisp|mars bars?|mars)\b/i;

  // "Maybe" rules: things we can't be sure about from the name alone. These get a ❓ badge
  // ("check the label") instead of being dimmed. A vegan modifier excuses them in both modes;
  // a vegetarian modifier only excuses them in Veggie mode. First match wins.
  const MAYBE_RULES = {
    both: [
      [/\b(jelly|jellies|gummy|gummies|marshmallows?|haribo|starburst|percy pigs?|wine gums|jelly babies|jelly beans|midget gems)\b/i, 'May contain gelatine'],
      [/\b(wines?(?! vinegar)|prosecco|champagne|cava|(?<!ginger |root )beers?|lagers?|ales?|stouts?|porter|ciders?(?! vinegar))\b/i, 'May be fined with fish/egg'],
      [/\b(worcestershire|caesar)\b/i, 'May contain anchovy'],
      [/\b(dippers|nuggets?|goujons?|kievs?|bolognese|doner|kebabs?|shawarma|katsu|ginsters|dalepak|(?<!bean |vegetable |veggie |veg |mushroom |halloumi |falafel |quinoa |plant )burgers?(?! buns| rolls| sauce| relish| seasoning| sauces))\b/i, 'Usually contains meat/fish'],
      [/\b(crowns?(?! prince)|roasting joints?|joints?|stuffing|gravy|christmas puddings?|figgy puddings?)\b/i, 'May contain meat/suet']
    ],
    vegetarian: [
      [/\b(pecorino|grana padano|gorgonzola|manchego|gruy[eè]re|emmental|comt[eé]|roquefort|pesto|italian hard cheese)\b/i, 'May use animal rennet']
    ],
    vegan: [
      [/\b(dark chocolate|raw chocolate)\b/i, 'Dark choc often has milk'],
      [/\b(mince pies?|christmas cakes?|gingerbread|selection box(?:es)?|advent calendars?)\b/i, 'Festive: often has milk/butter'],
      [/\b(cakes?|brownies?|cookies?|muffins?|pancakes?|waffles?|doughnuts?|donuts?|pastry|pastries|sponge (?:cakes?|puddings?|fingers)|crumpets?|biscuits?|fresh pasta|tagliatelle|pappardelle|gnocchi|creamy(?! (?:peanut|almond|cashew|hazelnut|nut) butter))\b/i, 'May contain egg/milk']
    ]
  };

  // "Roast Beef Flavour", "Prawn Cocktail": crisps & snacks that are often veggie or vegan
  const FLAVOUR_REGEX = /\b(flavou?r(?:ed)?|prawn cocktail|crisps)\b/i;

  // Not food: household, toiletries, baby, health, pet food & flowers. These skip every check
  // (including Ocado's "No V label"), so tissues or bin bags never get a warning. Brand names
  // that are also food words only count in their household form ("toilet duck", "comfort
  // fabric", "velvet toilet"). Pet food is exempt on purpose: it's for the pet, not for you.
  const HOUSEHOLD_TERMS = [
    // paper & kitchen
    'tissues?', 'toilet (?:roll|rolls|tissue|paper|cleaner|bleach|gel|blocks?)', 'loo roll', 'kitchen (?:roll|rolls|towels?)',
    'paper towels?', 'napkins', 'bin (?:bags|liners)', 'refuse sacks', 'cling ?film', '(?:kitchen|cooking|tin|aluminium) foil',
    'baking (?:paper|parchment)', 'greaseproof paper', '(?:freezer|sandwich|food) bags', 'scourers?', '(?:cleaning|scrub) sponges?',
    'rubber gloves', 'mops?', 'brooms?', 'dusters?', 'cloths',
    // cleaning & laundry
    'washing[- ]up liquid', 'dishwasher (?:tablets|tabs|pods|salt|rinse|cleaner|powder|gel)', 'laundry', 'detergent',
    'washing (?:powder|liquid|capsules|pods|gel|tablets)', 'non[- ]bio', 'fabric (?:conditioner|softener)', 'stain remover',
    'bleach', '(?:surface|bathroom|kitchen|glass|oven|floor|carpet|multi[- ]surface|all purpose) (?:cleaner|spray|wipes)',
    'disinfectant', 'anti[- ]?bacterial', 'limescale', 'drain unblocker', 'air fresheners?', 'plug[- ]in refills?',
    '(?:furniture|shoe|metal|silver) polish', 'descaler',
    // toiletries & health
    'shampoo', 'conditioner', 'shower gel', 'body wash', 'bubble bath', 'bath (?:foam|soak|salts)', 'hand wash', 'soap',
    'toothpaste', 'toothbrush(?:es)?', 'mouthwash', 'dental floss', 'deodorant', 'anti-?perspirant', 'razors?', 'shaving',
    'moisturi[sz]er', 'body lotion', 'hand cream', 'face wash', 'cleanser', 'sun ?cream', 'sunscreen', 'after sun',
    'lip balm', 'make[- ]?up', 'mascara', 'nail polish', 'hair (?:dye|colour|gel|spray|mousse)', 'cotton (?:wool|buds|pads)',
    'plasters', 'bandages?', 'paracetamol', 'ibuprofen', 'aspirin', 'antihistamines?', 'cold (?:&|and) flu',
    'sanitary (?:towels|pads)', 'tampons', 'panty ?liners', 'incontinence', 'condoms', 'pregnancy test',
    // baby
    'nappies', 'nappy', '(?:baby|wet|cleansing|make-?up|flushable) wipes', 'wipes',
    // home & misc
    'batteries', 'light ?bulbs?', 'candles?', 'matches', 'lighters?', 'charcoal', 'firelighters', 'bird ?seed',
    'bouquet', 'flowers', 'stems', 'houseplant', 'plant pot', 'compost', 'gift (?:card|wrap|bag)', 'greetings card', 'birthday card',
    // pets
    'dog food', 'cat food', 'pet food', '(?:dog|cat|puppy|kitten) (?:treats|biscuits|chews|food|pouches|meals?)',
    'for (?:dogs|cats|puppies|kittens)', 'cat litter', 'poo bags', 'kitten', 'puppy',
    // household, toiletry, baby & pet brands
    'kleenex', 'andrex', 'cushelle', 'charmin', 'regina (?:kitchen|blitz|towels?|rolls?)', 'velvet (?:toilet|quilted|tissue|comfort)',
    'persil', 'ariel', 'daz', 'lenor', 'comfort (?:fabric|pure|intense|creations|conditioner)', 'surf (?:tropical|washing|laundry)',
    'bold (?:2in1|washing|laundry)', 'fairy (?:liquid|non bio|platinum|original|washing|dishwasher|max power)', 'finish (?:quantum|powerball|ultimate|dishwasher)',
    'domestos', 'dettol', 'cif', 'harpic', 'toilet duck', 'mr muscle', 'zoflora', 'astonish', 'ecover', 'method (?:cleaner|surface)',
    'vanish', 'dylon', 'air ?wick', 'glade', 'febreze', 'oust', 'pledge', 'mr sheen', 'brillo', 'scotch[- ]?brite', 'jcloth', 'bacofoil',
    'colgate', 'oral[- ]?b', 'sensodyne', 'aquafresh', 'macleans', 'listerine', 'corsodyl', 'pantene', 'tresemm[eé]',
    'herbal essences', 'head (?:&|and) shoulders', 'nivea', 'dove (?:soap|deodorant|body|beauty|shower|cream|men|antiperspirant)',
    'lynx', 'gillette', 'wilkinson sword', 'tampax', 'bodyform', 'always (?:ultra|discreet|pads|liners|dailies)', 'pampers', 'huggies',
    'johnson\'?s baby', 'e45', 'vaseline', 'imperial leather', 'carex', 'radox', 'palmolive', 'original source', 'garnier',
    'l\'?or[eé]al', 'batiste', 'aussie (?:shampoo|conditioner|hair|miracle|mega)', 'alberto balsam', 'duracell', 'energizer',
    'whiskas', 'felix', 'pedigree', 'purina', 'iams', 'sheba', 'dreamies', 'webbox', 'harringtons', 'lily\'?s kitchen',
    'bonio', 'winalot', 'good boy', 'bakers (?:complete|meaty|dog)', 'cesar', 'arden grange', 'james wellbeloved', 'royal canin',
  ];
  const HOUSEHOLD_REGEX = new RegExp(`\\b(?:${HOUSEHOLD_TERMS.join('|')})\\b`, 'i');

  // Parmesan / Parmigiano Reggiano is always made with animal rennet, so never vegetarian
  const RENNET_REGEX = /\b(parmesan|parmigiano)\b/i;

  const IGNORE_WORDS = new Set([
    'sainsburys', 'sainsbury', 'asda', 'tesco', 'morrisons', 'ocado', 'waitrose', 'aldi', 'lidl',
    'iceland', 'coop', 'essential', 'everyday', 'value', 'special', 'taste', 'difference', 'by', 'the', 'and', 'with', 'in', 'of', 'for',
    'british', 'organic', 'free', 'range', 'fresh', 'sliced', 'diced', 'pack', 'large', 'medium',
    'small', 'extra', 'finest', 'style', 'recipe', 'traditional', 'classic', 'selection', 'ready',
    'meal', 'cooked', 'roasted', 'grilled', 'smoked', 'sweet', 'chilli', 'garlic', 'herb', 'spiced',
    'crispy', 'tender', 'juicy', 'rich', 'sauce', 'slices', 'pieces', 'chunks', 'fillets',
    'grams', 'ml', 'kg', 'serves', 'chargrilled', 'marinated', 'seasoned', 'lightly', 'dusted'
  ]);

  function normalizeTitle(t) {
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function getButtonLabel(isBlocked) {
    if (isBlocked) return '👁️ Show';
    return memory.mode === 'vegan' ? '🚫 Not Vegan' : '🚫 Not Veggie';
  }

  // All learned keywords as one regex, rebuilt only when the list changes
  let learnedCache = { key: null, regex: null };
  function learnedKeywordsRegex() {
    const words = lists().customBlockedWords;
    const key = memory.mode + '\u0000' + words.join('\u0000');
    if (learnedCache.key !== key) {
      const escaped = [...words].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      learnedCache = { key, regex: escaped.length ? new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i') : null };
    }
    return learnedCache.regex;
  }

  // diet = 'vegan' | 'vegetarian' | '' : a dietary label the shop itself shows on the tile
  // shopLabels = true when this shop labels its products, so a missing label means something
  function classify(rawTitle, diet = '', shopLabels = false) {
    const norm = normalizeTitle(rawTitle);

    // 1. User Whitelist / Blacklist
    if (lists().allowedProducts.includes(norm)) {
      return { blocked: false, reason: 'Undimmed by You' };
    }
    if (lists().blockedProducts.includes(norm)) {
      return { blocked: true, reason: 'Flagged by You' };
    }

    // 2. User Learned Keywords
    const learned = learnedKeywordsRegex();
    const learnedMatch = learned && norm.match(learned);
    if (learnedMatch) {
      return { blocked: true, reason: `Learned (${learnedMatch[0]})` };
    }

    // 2a. Not food (tissues, cleaning, toiletries, pet food…): nothing to check
    if (HOUSEHOLD_REGEX.test(norm.replace(/[‘’]/g, "'"))) {
      return { blocked: false, reason: '' };
    }

    // 2b. The shop's own dietary label beats our guesses from the name
    if (diet === 'vegan') {
      return { blocked: false, reason: '' };
    }
    if (diet === 'vegetarian' && memory.mode === 'vegetarian') {
      return { blocked: false, reason: '' };
    }

    // 3. Scrub safe multi-word compounds ("peanut butter", "butternut squash", "dark chocolate", etc.)
    // Curly apostrophes are straightened so "Fry’s" / "This Isn’t" match the modifier lists.
    const text = norm.replace(/[‘’]/g, "'");
    const cleaned = text.replace(SAFE_REGEX, ' ___ ');

    const isStrictlyVeganMod = VEGAN_MOD_REGEX.test(text);
    const isVeggieMod = isStrictlyVeganMod || VEGGIE_MOD_REGEX.test(text);

    // "Maybe" = not dimmed, just marked ❓ so the user checks the label. On shops that label
    // their products (shopLabels), a ❓ item that got this far has no V / vegan label
    // (labelled items returned in 2b), so it's dimmed instead.
    const maybe = (why) => shopLabels
      ? { blocked: true, reason: `No ${memory.mode === 'vegan' ? 'vegan' : 'V'} label: ${why}` }
      : { blocked: false, maybe: true, reason: why };

    const meatMatch = cleaned.match(MEAT_REGEX);
    const dairyMatch = cleaned.match(DAIRY_REGEX);

    // Meat check: excused by either Vegan OR Veggie modifier
    if (meatMatch && !isVeggieMod) {
      if (FLAVOUR_REGEX.test(text)) return maybe(`Flavouring, may be veggie (${meatMatch[0]})`);
      return { blocked: true, reason: `Meat/Fish (${meatMatch[0]})` };
    }

    const rennetMatch = cleaned.match(RENNET_REGEX);
    if (memory.mode === 'vegetarian' && rennetMatch && !isVeggieMod) {
      return { blocked: true, reason: `Animal rennet (${rennetMatch[0]})` };
    }

    // Vegan check: Dairy/Egg/Butter/Chocolate is ONLY excused by a strictly Vegan modifier!
    if (memory.mode === 'vegan' && dairyMatch && !isStrictlyVeganMod) {
      return { blocked: true, reason: `Non-Vegan (${dairyMatch[0]})` };
    }

    // 4. "Maybe" tier (maybe() is defined above the meat check)
    const excused = memory.mode === 'vegan' ? isStrictlyVeganMod : isVeggieMod;
    if (!excused) {
      for (const [regex, label] of [...MAYBE_RULES.both, ...MAYBE_RULES[memory.mode]]) {
        const m = text.match(regex);
        if (m) return maybe(`${label} (${m[0]})`);
      }
    }
    if (memory.mode === 'vegan' && isVeggieMod && !isStrictlyVeganMod) {
      return maybe('Veggie, may not be vegan');
    }

    // On labelling shops even fruit & veg carry a V, so no label at all is worth a ❓
    if (shopLabels && !diet) {
      return { blocked: false, maybe: true, reason: 'No V label' };
    }

    return { blocked: false, reason: '' };
  }

  // 5. Site-agnostic Card Discovery (Sainsbury's, Asda, Tesco, Morrisons, Ocado, Waitrose...)
  // A card is the biggest ancestor of a product link that still contains only ONE product.
  // (The old generic fallbacks like closest('li') could grab a whole carousel/grid row, so a
  // single "card" held many products, got classified by the first title only, and the
  // Flag button landed on the wrong element.)
  // Product links are anything whose path has /product/<something> or /products/<something>.
  // Amazon: /dp/B0XXXXXXXX or /gp/product/B0XXXXXXXX (keyed by that product ID, the ASIN,
  // because one Amazon tile links the same product with several different URLs)
  const PRODUCT_LINK_SEL = 'a[href*="/product"], a[href*="/dp/"]';
  const PRODUCT_PATH_REGEX = /\/products?\/[^/?#]+|^asin:/i;
  const ASIN_REGEX = /\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:[/?#]|$)/i;
  const HEADING_SEL = 'h1, h2, h3, h4';
  // (no leading \s*: that made it slow on long runs of spaces; titles are whitespace-collapsed
  // before this runs, so a single optional space is enough)
  const PRICE_TAIL_REGEX = / ?(?:£ ?\d|was £|now £)[\s\S]*$/i;
  const KNOWN_TILE_SEL = 'li.pt-grid-item, article.pt, .ln-c-card.pt, [data-test-id="product-tile"], [data-testid="product-tile"], [data-component-type="s-search-result"]';
  const STOP_TAGS = new Set(['BODY', 'HTML', 'MAIN', 'NAV', 'HEADER', 'FOOTER']);
  // Product links inside menus, nav bars and pop-up dialogs are never product tiles
  const NOT_A_TILE_SEL = 'nav, header, footer, [role="navigation"], [role="menu"], [role="menubar"], [role="dialog"], [aria-modal="true"], [class*="megamenu" i], [class*="mega-menu" i], [class*="navigation" i]';
  // A product tile has a handful of links (image, title, reviews, offer, favourite) and no
  // search box; a header or menu has dozens. Climbing stops before a box looks like that.
  // (Size can't be used: list views have full-width tiles, and an open menu doesn't add to its
  // header's height.)
  const MAX_TILE_LINKS = 15;
  const SEARCH_BOX_SEL = 'input[type="search"], [role="search"], form[action*="search" i]';
  const UI_TEXT_REGEX = /^(view all|shop now|see more|add|trolley|view product|more info|reviews?|\(?\d+\)?|[\d.]+ out of 5.*)$/i;

  function productKey(a) {
    try {
      const path = new URL(a.getAttribute('href'), location.href).pathname;
      const asin = path.match(ASIN_REGEX);
      if (asin) return `asin:${asin[1].toLowerCase()}`;
      return path.replace(/\/+$/, '').toLowerCase();
    } catch (e) {
      return a.getAttribute('href') || '';
    }
  }

  // Dietary labels the shop puts on the tile (e.g. Ocado's "V" icon, "Suitable for vegans").
  // Read from icon alt/title/aria-label text and tiny standalone labels, never from our own buttons.
  // The whole text must BE a label ("Vegetarian", "Suitable for vegans", "Lifestyle: vegan icon"),
  // so a product name like "Quorn Vegetarian Sausages" in an image's alt text doesn't count.
  const DIET_LABEL_REGEX = /^(?:[a-z ]{0,20}[:\-–] ?)?(suitable for vegans?|suitable for vegetarians?|vegan|vegetarian|ve|v)(?: (?:icon|logo|symbol|badge|friendly|diet))?\.?$/i;

  // Turns an icon file name into words: "_010_VeganSociety?&$icon$" → "vegan society".
  // A whole product photo name like "quorn-vegetarian-sausages.jpg" becomes
  // "quorn vegetarian sausages", which the label regex rejects because it isn't purely a label.
  function iconNameFromUrl(src) {
    const file = (src || '').split(/[?#]/)[0].split('/').pop() || '';
    const words = file
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[\d_\-]+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/^(vegan|vegetarian) society$/, '$1');
    return words;
  }

  const DIET_TEXT_HINT_REGEX = /\bve?\b|vegan|vegetarian/i;

  function readDietLabel(card) {
    let found = '';
    const consider = (raw) => {
      const m = (raw || '').replace(/\s+/g, ' ').trim().match(DIET_LABEL_REGEX);
      if (!m) return;
      const word = m[1].toLowerCase();
      if (word.includes('vegan') || word === 've') found = 'vegan';
      else if (!found) found = 'vegetarian';
    };
    card.querySelectorAll('[alt], [title], [aria-label], svg title').forEach(el => {
      if (el.closest('.vf-override-btn, .vf-ok-btn')) return;
      if (el.tagName.toLowerCase() === 'title') consider(el.textContent);
      else ['alt', 'title', 'aria-label'].forEach(a => consider(el.getAttribute(a)));
    });
    // Asda: <img alt="Informational roundel" src=".../_010_VeganSociety?&$icon-wapp$">
    card.querySelectorAll('img[src]').forEach(img => consider(iconNameFromUrl(img.getAttribute('src'))));
    // Morrisons: <use href=".../icons-dark.svg#vegetarian">
    card.querySelectorAll('use').forEach(u => {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
      if (href.includes('#')) consider(href.split('#').pop());
    });
    // Tiny standalone text labels ("V", "Vegan"): only walk the tile if its text could hold one
    if (DIET_TEXT_HINT_REGEX.test(card.textContent)) {
      card.querySelectorAll('span, small, abbr, b, i, p, div').forEach(el => {
        if (el.childElementCount === 0 && !el.closest('.vf-override-btn, .vf-ok-btn, .vf-badge')) consider(el.textContent);
      });
    }
    return found;
  }

  function findProductCards() {
    const cardMap = new Map(); // Map<Element, { title, diet }>
    const keyCountCache = new Map();
    const keyCache = new Map(); // each link's URL is only parsed once per scan

    const keyOf = (a) => {
      if (!keyCache.has(a)) keyCache.set(a, productKey(a));
      return keyCache.get(a);
    };
    const isProductLink = (a) => PRODUCT_PATH_REGEX.test(keyOf(a));
    const productLinksIn = (el) => [...el.querySelectorAll(PRODUCT_LINK_SEL)].filter(isProductLink);

    const countKeys = (el) => {
      if (keyCountCache.has(el)) return keyCountCache.get(el);
      const keys = new Set();
      productLinksIn(el).forEach(a => keys.add(keyOf(a)));
      keyCountCache.set(el, keys.size);
      return keys.size;
    };

    // Menus, pop-ups and quick-view panels float above the page (fixed, or absolute with a high
    // z-index); product links inside them are never tiles. (Carousel slides are absolute too,
    // but sit at a low z-index.)
    const overlayCache = new Map();
    const inOverlay = (el) => {
      if (!el || el === document.body || el === document.documentElement) return false;
      if (!overlayCache.has(el)) {
        const cs = getComputedStyle(el);
        const z = parseInt(cs.zIndex, 10);
        const floating = cs.position === 'fixed' || (cs.position === 'absolute' && z >= 10);
        overlayCache.set(el, floating || inOverlay(el.parentElement));
      }
      return overlayCache.get(el);
    };

    const notTileCache = new Map();
    const tooBig = (el) => {
      if (!notTileCache.has(el)) {
        notTileCache.set(el, el.getElementsByTagName('a').length > MAX_TILE_LINKS || !!el.querySelector(SEARCH_BOX_SEL));
      }
      return notTileCache.get(el);
    };

    const cardFor = (link) => {
      const known = link.closest(KNOWN_TILE_SEL);
      if (known && !known.querySelector(KNOWN_TILE_SEL)) return known;

      let el = link;
      while (el.parentElement && !STOP_TAGS.has(el.parentElement.tagName)) {
        const parent = el.parentElement;
        if (countKeys(parent) > 1 || tooBig(parent)) break;
        el = parent;
      }
      return tooBig(el) ? null : el;
    };

    const links = productLinksIn(document)
      .filter(a => !a.closest('#vf-floating-ui, #vf-memory-modal, #vf-toast-ui') && !a.closest(NOT_A_TILE_SEL));

    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(PRICE_TAIL_REGEX, '');

    links.forEach(link => {
      const card = cardFor(link);
      if (!card || cardMap.has(card)) return;
      // Every real product tile has a product image; text-only links (menus, lists) don't
      if (!card.querySelector('img, picture')) return;
      if (inOverlay(card)) return;
      if (amazonUnitPriceOnly && !UNIT_PRICE_REGEX.test(card.textContent)) return;

      // Title: a heading that holds a product link (most sites), else the longest real
      // product-link text (image / review links skipped). Prices are trimmed off the end, in
      // case a site wraps the whole tile in one link, so a price change doesn't lose a flag.
      let title = '';
      const heading = [...card.querySelectorAll(HEADING_SEL)].find(h => h.querySelector(PRODUCT_LINK_SEL) || h.closest(PRODUCT_LINK_SEL));
      if (heading) title = clean(heading.textContent);
      if (title.length < 3 || UI_TEXT_REGEX.test(title)) {
        title = '';
        productLinksIn(card).forEach(a => {
          const t = clean(a.textContent) || clean(a.getAttribute('aria-label'));
          if (t.length >= 3 && !UI_TEXT_REGEX.test(t) && t.length > title.length) title = t;
        });
      }
      if (!title) {
        const img = card.querySelector('img[alt]');
        title = (img?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      }
      if (title.length >= 3) cardMap.set(card, { title, diet: readDietLabel(card) });
    });

    return cardMap;
  }

  function updateControlBarUI() {
    const modeBtn = ui$('vf-mode-btn');
    const actBtn = ui$('vf-act-btn');
    if (modeBtn) {
      modeBtn.textContent = memory.mode === 'vegetarian' ? 'Vegetarian' : 'Strictly Vegan';
      modeBtn.style.background = memory.mode === 'vegetarian' ? '#10b981' : '#f59e0b';
    }
    if (actBtn) {
      actBtn.textContent = `Action: ${memory.action === 'dim' ? 'Blur' : 'Hide'}`;
    }
  }

  // Shops that put a V / vegan icon on (nearly) every suitable product, even fruit & veg
  const LABELLING_HOSTS_REGEX = /(^|\.)ocado\.com$/i;
  let pageHasShopLabels = false;
  let productsOnPage = false;
  // Started from the toolbar icon: keep the widget visible even with no products found,
  // so it's obvious the click worked
  let forcedVisible = isExtension && forced;

  // The widget only shows on pages with products (not checkout, account pages etc.), either
  // full size or minimised to a small pill
  function updateWidgetVisibility() {
    const full = ui$('vf-floating-ui');
    const pill = ui$('vf-pill');
    if (!full || !pill) return;
    const show = productsOnPage || forcedVisible || !!ui$('vf-memory-modal');
    full.style.display = show && !memory.minimised ? 'flex' : 'none';
    pill.style.display = show && memory.minimised ? 'block' : 'none';
  }

  // The real state of each tile lives here, out of the page's reach. The data-vf-* attributes
  // are only copies for styling: the page can rewrite them, so the code never trusts them.
  let cardState = new WeakMap(); // card → { title, diet, blocked, maybe, reason }

  const VF_ATTRS = ['data-vf-scanned', 'data-vf-blocked', 'data-vf-maybe', 'data-vf-action', 'data-vf-reason', 'data-vf-title', 'data-vf-diet', 'data-vf-pos'];
  function unmarkCard(el) {
    cardState.delete(el);
    VF_ATTRS.forEach(a => el.removeAttribute(a));
    el.querySelectorAll(':scope > .vf-override-btn, :scope > .vf-ok-btn, :scope > .vf-badge').forEach(b => b.remove());
  }

  // Only touch the page when a value actually changes: re-setting an attribute to the same value
  // still makes the browser re-check that tile's styles
  const setAttr = (el, name, value) => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };
  const dropAttr = (el, name) => {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  };

  // Changes are applied in batches, one per animation frame, so a page with hundreds of
  // products never freezes. Small pages (one batch) update in one go.
  const SCAN_BATCH = 60;
  let scanGeneration = 0;

  function scanPage(forceRescan = false) {
    if (!active) return;
    const generation = ++scanGeneration; // a newer scan cancels the rest of this one

    const cardMap = findProductCards();
    const entries = [...cardMap];
    let blockedCount = 0;
    let maybeCount = 0;

    // Does this shop label (nearly) everything, so a MISSING label means something? Only shops
    // known to do that: Asda/Morrisons show labels on some products only, so they don't count.
    if (!pageHasShopLabels && LABELLING_HOSTS_REGEX.test(location.hostname)) {
      pageHasShopLabels = true;
      forceRescan = true;
    }

    // Read phase first: every style read happens before any change to the page. Mixing reads
    // and writes forces the browser to recalculate styles once per tile, which froze big pages.
    const needsPosition = new Set();
    entries.forEach(([card]) => {
      if (!card.hasAttribute('data-vf-scanned') && getComputedStyle(card).position === 'static') needsPosition.add(card);
    });

    const applyCard = ([card, { title: rawTitle, diet }]) => {
      const prev = cardState.get(card);
      if (forceRescan || !prev || prev.title !== rawTitle || prev.diet !== diet) {
        const res = classify(rawTitle, diet, pageHasShopLabels);
        cardState.set(card, { title: rawTitle, diet, blocked: !!res.blocked, maybe: !!res.maybe, reason: (res.blocked || res.maybe) ? res.reason : '' });
        if (needsPosition.has(card)) setAttr(card, 'data-vf-pos', '1');
        setAttr(card, 'data-vf-title', rawTitle);
        setAttr(card, 'data-vf-diet', diet);
        if (res.blocked || res.maybe) setAttr(card, 'data-vf-reason', res.reason);
        else dropAttr(card, 'data-vf-reason');
      }

      const state = cardState.get(card);
      const isBlocked = state.blocked;
      const isMaybe = state.maybe;
      // re-apply the styling copies every scan, in case the page rewrote them
      setAttr(card, 'data-vf-scanned', 'true');
      setAttr(card, 'data-vf-blocked', isBlocked ? 'true' : 'false');
      setAttr(card, 'data-vf-maybe', isMaybe ? 'true' : 'false');

      // "Looks fine" button only on ❓ cards, to dismiss the warning for this product
      let okBtn = card.querySelector(':scope > .vf-ok-btn');
      if (isMaybe && !okBtn) {
        okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'vf-ok-btn';
        okBtn.textContent = '✓ Fine';
        okBtn.title = 'Looks fine: stop warning about this product';
        card.appendChild(okBtn);
      } else if (!isMaybe && okBtn) {
        okBtn.remove();
      }
      if (isMaybe) maybeCount++;

      // Reason badge (🚫 on blurred cards, ❓ on maybe cards)
      const reason = state.reason;
      const badgeText = isMaybe ? `❓ Check label: ${reason}` : (isBlocked && memory.action === 'dim') ? `🚫 ${reason}` : '';
      let badge = card.querySelector(':scope > .vf-badge');
      if (badgeText) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'vf-badge';
          card.appendChild(badge);
        }
        if (badge.textContent !== badgeText) badge.textContent = badgeText;
        badge.classList.toggle('vf-badge--maybe', isMaybe);
      } else if (badge) {
        badge.remove();
      }

      let btn = card.querySelector(':scope > .vf-override-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vf-override-btn';
        card.appendChild(btn);
      }
      const targetLabel = getButtonLabel(isBlocked);
      if (btn.textContent !== targetLabel) btn.textContent = targetLabel;
      // Full reason on hover, since the badge gets truncated on narrow tiles
      if (btn.title !== reason) btn.title = reason;

      if (isBlocked) {
        blockedCount++;
        setAttr(card, 'data-vf-action', memory.action);
      } else {
        dropAttr(card, 'data-vf-action');
      }
    };

    const finish = () => {
      const total = entries.length;
      const statsEl = ui$('vf-stats');
      if (statsEl) {
        const learnedTotal = lists().blockedProducts.length + lists().customBlockedWords.length + lists().allowedProducts.length;
        statsEl.textContent = total
          ? `Filtered ${blockedCount}/${total} • ❓ ${maybeCount} • 🧠 ${learnedTotal}`
          : 'No products found on this page yet';
      }
      // Anything we marked earlier that's no longer a product tile (page re-rendered): unmark it
      document.querySelectorAll('[data-vf-scanned]').forEach(el => {
        if (!cardMap.has(el)) unmarkCard(el);
      });

      const pillEl = ui$('vf-pill');
      if (pillEl) pillEl.textContent = `🌱 ${blockedCount} ${memory.action === 'hide' ? 'hidden' : 'blurred'}${maybeCount ? ` • ❓ ${maybeCount}` : ''}`;
      productsOnPage = total > 0;
      updateWidgetVisibility();
    };

    const runBatch = (from) => {
      if (!active || generation !== scanGeneration) return;
      entries.slice(from, from + SCAN_BATCH).forEach(applyCard);
      if (from + SCAN_BATCH < entries.length) requestAnimationFrame(() => runBatch(from + SCAN_BATCH));
      else finish();
    };
    runBatch(0);
  }

  // 6. Keyword Learning Toast
  function showKeywordToast(rawTitle) {
    ui$('vf-toast-ui')?.remove();

    const candidates = [...new Set(
      rawTitle.toLowerCase()
        .replace(/[^a-z\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !IGNORE_WORDS.has(w) && !lists().customBlockedWords.includes(w))
    )].slice(0, 6);

    if (candidates.length === 0) return;

    const flagTitle = memory.mode === 'vegan' ? '🚫 Flagged as Non-Vegan!' : '🚫 Flagged as Non-Veggie!';

    const toast = document.createElement('div');
    toast.id = 'vf-toast-ui';
    toast.style.cssText = `position:fixed;bottom:${aboveWidget()}px;right:20px;z-index:999999;background:#1e293b;color:#f8fafc;padding:12px 16px;border-radius:12px;font-family:sans-serif;font-size:12px;box-shadow:0 10px 25px rgba(0,0,0,0.45);border:1px solid #475569;max-width:360px;`;
    toast.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="color:#fca5a5;">${flagTitle}</strong>
        <button id="vf-toast-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
      </div>
      <div style="color:#cbd5e1;margin-bottom:8px;">Also block a keyword from this title across all items?</div>
      <div id="vf-word-chips" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
    `;
    uiRoot.appendChild(toast);

    const chipContainer = toast.querySelector('#vf-word-chips');
    candidates.forEach(word => {
      const chip = document.createElement('button');
      chip.textContent = `+ "${word}"`;
      chip.style.cssText = 'background:#334155;color:#f8fafc;border:1px solid #64748b;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;cursor:pointer;';
      chip.onclick = () => {
        if (!lists().customBlockedWords.includes(word)) {
          lists().customBlockedWords.push(word);
          saveMemory();
          scanPage(true);
          if (ui$('vf-memory-modal')) renderMemoryModal();
        }
        toast.remove();
      };
      chipContainer.appendChild(chip);
    });

    toast.querySelector('#vf-toast-close').onclick = () => toast.remove();
    setTimeout(() => toast?.remove(), 9000);
  }

  // 7. Delegated Click Handler for Flag / Undim Button
  window.__vfClickHandler = (e) => {
    const btn = e.target.closest('.vf-override-btn, .vf-ok-btn');
    if (!btn) return;
    // Only real clicks: the page's own scripts can't flag or undim things for you
    if (!e.isTrusted) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // The tile must be one we found ourselves, and its title comes from our own records
    // (a fake tile, or a rewritten data-vf-title attribute, is ignored)
    const card = btn.parentElement;
    const state = card && cardState.get(card);
    if (!state) return;

    const rawTitle = state.title;
    const norm = normalizeTitle(rawTitle);
    const currentlyBlocked = state.blocked;

    // "Looks fine" on a ❓ card and "Undim" on a dimmed card both mark the product as allowed
    if (currentlyBlocked || btn.classList.contains('vf-ok-btn')) {
      lists().blockedProducts = lists().blockedProducts.filter(t => t !== norm);
      if (!lists().allowedProducts.includes(norm)) lists().allowedProducts.push(norm);
      saveMemory();
      scanPage(true);
      if (ui$('vf-memory-modal')) renderMemoryModal();
    } else {
      lists().allowedProducts = lists().allowedProducts.filter(t => t !== norm);
      if (!lists().blockedProducts.includes(norm)) lists().blockedProducts.push(norm);
      saveMemory();
      scanPage(true);
      if (ui$('vf-memory-modal')) renderMemoryModal();
      showKeywordToast(rawTitle);
    }
  };
  document.addEventListener('click', window.__vfClickHandler, true);

  // 8. Memory Modal with Ko-fi Link in Top-Right, Export/Import & "No backup! Local only." Warning
  function renderMemoryModal(statusMessage = '') {
    ui$('vf-memory-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'vf-memory-modal';
    modal.style.cssText = `position:fixed;bottom:${aboveWidget()}px;right:20px;z-index:999999;background:#0f172a;color:#f8fafc;padding:16px;border-radius:12px;font-family:sans-serif;font-size:12px;box-shadow:0 12px 30px rgba(0,0,0,0.55);border:1px solid #334155;width:370px;max-height:500px;overflow-y:auto;`;

    // Product names come from the shop's page, so they're escaped before going into HTML
    const wordsHtml = lists().customBlockedWords.length
      ? lists().customBlockedWords.map(w => `<span class="vf-mem-pill" data-type="word" data-val="${escapeHtml(w)}" title="Click to remove">${escapeHtml(w)} <b style="color:#f87171;">×</b></span>`).join('')
      : '<span style="color:#64748b;">None yet</span>';

    const blockedHtml = lists().blockedProducts.length
      ? lists().blockedProducts.map(p => `<div class="vf-mem-pill" data-type="blocked" data-val="${escapeHtml(p)}" title="Click to remove" style="display:flex;justify-content:space-between;"><span>${escapeHtml(p)}</span><b style="color:#f87171;margin-left:6px;">×</b></div>`).join('')
      : '<span style="color:#64748b;">None yet</span>';

    const allowedHtml = lists().allowedProducts.length
      ? lists().allowedProducts.map(p => `<div class="vf-mem-pill" data-type="allowed" data-val="${escapeHtml(p)}" title="Click to remove" style="display:flex;justify-content:space-between;"><span>${escapeHtml(p)}</span><b style="color:#f87171;margin-left:6px;">×</b></div>`).join('')
      : '<span style="color:#64748b;">None yet</span>';

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:6px;">
        <strong style="font-size:13px;color:#34d399;">🧠 ${modeName()} Memory</strong>
        <div style="display:flex;align-items:center;gap:6px;">
          ${isExtension ? '<button id="vf-mem-help" title="Open the Help & memory page (both modes, export & import)" style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;cursor:pointer;">📖 Full page</button>' : ''}
          <button id="vf-mem-close" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:15px;">✕</button>
        </div>
      </div>

      <div style="color:#94a3b8;font-size:11px;margin:-6px 0 10px;">Showing the ${modeName()} list only. Flags in one mode never affect the other. Switch mode to see its list.</div>

      ${statusMessage ? `<div style="background:#064e3b;border:1px solid #10b981;color:#a7f3d0;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:600;margin-bottom:10px;">${statusMessage}</div>` : ''}

      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <button id="vf-mem-export" style="flex:1;background:#1e293b;color:#38bdf8;border:1px solid #0284c7;padding:6px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">
          💾 Export Backup (.json)
        </button>
        <button id="vf-mem-import" style="flex:1;background:#1e293b;color:#a78bfa;border:1px solid #7c3aed;padding:6px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">
          📂 Import Backup (.json)
        </button>
        <input type="file" id="vf-mem-file-input" accept=".json,application/json" style="display:none;" />
      </div>

      <div style="margin-bottom:10px;">
        <div style="color:#94a3b8;font-weight:700;margin-bottom:4px;">Blocked Keywords (${lists().customBlockedWords.length}):</div>
        <div style="color:#fca5a5;display:flex;flex-wrap:wrap;">${wordsHtml}</div>
      </div>

      <div style="margin-bottom:10px;">
        <div style="color:#94a3b8;font-weight:700;margin-bottom:4px;">Flagged Items (${lists().blockedProducts.length}):</div>
        <div style="color:#cbd5e1;max-height:85px;overflow-y:auto;">${blockedHtml}</div>
      </div>

      <div style="margin-bottom:12px;">
        <div style="color:#94a3b8;font-weight:700;margin-bottom:4px;">Undimmed / Allowed (${lists().allowedProducts.length}):</div>
        <div style="color:#6ee7b7;max-height:85px;overflow-y:auto;">${allowedHtml}</div>
      </div>

      <div style="background:#451a03;border:1px solid #92400e;color:#fde68a;padding:8px 10px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:8px;text-align:center;">
        ⚠️ No backup! Local only. (Use Export above to save a copy)
      </div>

      <button id="vf-mem-reset" style="width:100%;background:#7f1d1d;color:#fecaca;border:1px solid #dc2626;padding:7px;border-radius:6px;font-weight:700;cursor:pointer;">
        Reset ${modeName()} Keywords & Memory
      </button>
    `;
    uiRoot.appendChild(modal);

    const memHelp = modal.querySelector('#vf-mem-help');
    if (memHelp) memHelp.onclick = openHelpPage;
    modal.querySelector('#vf-mem-close').onclick = () => {
      modal.remove();
      updateWidgetVisibility();
    };

    modal.querySelectorAll('.vf-mem-pill').forEach(pill => {
      pill.onclick = () => {
        const type = pill.getAttribute('data-type');
        const val = pill.getAttribute('data-val');
        if (type === 'word') lists().customBlockedWords = lists().customBlockedWords.filter(w => w !== val);
        if (type === 'blocked') lists().blockedProducts = lists().blockedProducts.filter(p => p !== val);
        if (type === 'allowed') lists().allowedProducts = lists().allowedProducts.filter(p => p !== val);
        saveMemory();
        scanPage(true);
        renderMemoryModal();
      };
    });

    modal.querySelector('#vf-mem-export').onclick = () => {
      const payload = {
        version: 2,
        exportedAt: new Date().toISOString(),
        mode: memory.mode,
        action: memory.action,
        lists: memory.lists
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `herbivore-backup-${dateStr}.json`;
      uiRoot.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      renderMemoryModal('✅ Backup downloaded!');
    };

    const fileInput = modal.querySelector('#vf-mem-file-input');
    // The file picker only counts if opened by a real click on Import
    let importArmed = false;
    modal.querySelector('#vf-mem-import').onclick = (e) => {
      if (!e.isTrusted) return;
      importArmed = true;
      fileInput.click();
    };

    fileInput.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file || !importArmed) return;
      importArmed = false;
      if (file.size > 2_000_000) {
        renderMemoryModal('❌ That file is too big to be a Herbivore backup.');
        return;
      }
      try {
        const imported = JSON.parse(await file.text());
        if (!imported || typeof imported !== 'object') throw new Error('bad backup');
        mergeLists(memory, imported); // handles both per-mode (v2) and old flat (v1) backups
        if (imported.mode === 'vegan' || imported.mode === 'vegetarian') {
          memory.mode = imported.mode;
        }
        if (imported.action === 'dim' || imported.action === 'hide') {
          memory.action = imported.action;
        }
        const ok = await saveMemory();
        updateControlBarUI();
        scanPage(true);
        renderMemoryModal(ok ? '✅ Backup merged & restored!' : "❌ Couldn't save the restored backup.");
      } catch (err) {
        renderMemoryModal('❌ Invalid JSON backup file.');
      }
    };

    let confirmStep = false;
    const resetBtn = modal.querySelector('#vf-mem-reset');
    resetBtn.onclick = () => {
      if (!confirmStep) {
        confirmStep = true;
        resetBtn.style.background = '#dc2626';
        resetBtn.style.color = '#ffffff';
        resetBtn.textContent = `⚠️ Confirm Wipe ${modeName()} memory? (No backup! Local only.)`;
        return;
      }
      memory.lists[memory.mode] = emptyLists();
      saveMemory();
      scanPage(true);
      renderMemoryModal(`🗑️ ${modeName()} memory wiped.`);
    };
  }

  // Extension only: the Help & memory page (both modes' saved items, export/import)
  function openHelpPage() {
    try {
      chrome.runtime.sendMessage({ type: 'vf-open-help' });
    } catch (e) {} // extension was reloaded while this tab stayed open
  }

  function modeName() {
    return memory.mode === 'vegan' ? 'Vegan' : 'Veggie';
  }

  function toggleMemoryModal() {
    if (ui$('vf-memory-modal')) {
      ui$('vf-memory-modal').remove();
      updateWidgetVisibility();
    } else {
      renderMemoryModal();
    }
  }

  // 9. Floating Bottom-Right Control Widget (with Top-Right Ko-fi Button), plus a minimised pill
  function buildWidget() {
    const ui = document.createElement('div');
    ui.id = 'vf-floating-ui';
    ui.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#0f172a;color:#f8fafc;padding:10px 14px;border-radius:12px;font-family:sans-serif;font-size:13px;box-shadow:0 10px 25px rgba(0,0,0,0.45);border:1px solid #334155;display:none;flex-direction:column;gap:8px;';
    ui.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid #1e293b;padding-bottom:6px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-weight:700;color:#34d399;">🌱 Herbivore</span>
          <span id="vf-stats" style="color:#94a3b8;font-size:11px;">0/0</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          ${isExtension ? '<button id="vf-help-btn" title="Help & your saved items" style="background:transparent;color:#94a3b8;border:none;font-size:14px;font-weight:700;cursor:pointer;padding:0 2px;">?</button>' : ''}
          <button id="vf-min-btn" title="Minimise (filtering keeps running)" style="background:transparent;color:#94a3b8;border:none;font-size:15px;cursor:pointer;padding:0 2px;">–</button>
          <button id="vf-close-btn" title="Turn off until the page is reloaded" style="background:transparent;color:#94a3b8;border:none;font-size:15px;cursor:pointer;padding:0 2px;">✕</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button id="vf-mode-btn" style="background:${memory.mode === 'vegetarian' ? '#10b981' : '#f59e0b'};color:#022c22;border:none;padding:5px 10px;border-radius:6px;font-weight:700;cursor:pointer;flex:1;">${memory.mode === 'vegetarian' ? 'Vegetarian' : 'Strictly Vegan'}</button>
        <button id="vf-act-btn" style="background:#334155;color:#fff;border:none;padding:5px 10px;border-radius:6px;font-weight:600;cursor:pointer;">Action: ${memory.action === 'dim' ? 'Blur' : 'Hide'}</button>
        <button id="vf-mem-btn" style="background:#1e293b;color:#cbd5e1;border:1px solid #475569;padding:5px 8px;border-radius:6px;font-weight:600;cursor:pointer;">🧠 Memory</button>
      </div>
      ${isExtension && forced && location.protocol === 'https:' ? `<button id="vf-always-btn" title="Run automatically every time you visit this site" style="background:#1e293b;color:#34d399;border:1px solid #10b981;padding:5px 8px;border-radius:6px;font-weight:700;cursor:pointer;">📌 Always run on ${escapeHtml(location.hostname)}</button>` : ''}
      <div style="color:#64748b;font-size:10px;">A helper, not a guarantee: always check the label.</div>
    `;
    uiRoot.appendChild(ui);

    const pill = document.createElement('button');
    pill.id = 'vf-pill';
    pill.type = 'button';
    pill.title = 'Open Herbivore';
    pill.style.display = 'none';
    pill.textContent = '🌱';
    uiRoot.appendChild(pill);

    const setMinimised = (value) => {
      memory.minimised = value;
      saveMemory();
      if (value) ui$('vf-memory-modal')?.remove();
      updateWidgetVisibility();
    };
    pill.onclick = () => setMinimised(false);
    ui$('vf-min-btn').onclick = () => setMinimised(true);

    ui$('vf-mode-btn').onclick = () => {
      memory.mode = memory.mode === 'vegetarian' ? 'vegan' : 'vegetarian';
      saveMemory();
      updateControlBarUI();
      scanPage(true);
      ui$('vf-toast-ui')?.remove();
      if (ui$('vf-memory-modal')) renderMemoryModal();
    };

    ui$('vf-act-btn').onclick = () => {
      memory.action = memory.action === 'dim' ? 'hide' : 'dim';
      saveMemory();
      updateControlBarUI();
      scanPage(false);
    };

    ui$('vf-mem-btn').onclick = toggleMemoryModal;
    ui$('vf-close-btn').onclick = () => window.__vfTeardown();

    const helpBtn = ui$('vf-help-btn');
    if (helpBtn) helpBtn.onclick = openHelpPage;

    // Only the extension's own panel may ask Chrome for site access, so this opens it
    const alwaysBtn = ui$('vf-always-btn');
    if (alwaysBtn) {
      alwaysBtn.onclick = () => {
        try {
          chrome.runtime.sendMessage({ type: 'vf-open-site-panel' });
        } catch (e) {} // extension was reloaded while this tab stayed open
      };
    }
  }

  // The panel saved this site: swap the button for a confirmation
  function onExtensionMessage(msg) {
    if (msg?.type !== 'vf-site-saved') return;
    const btn = ui$('vf-always-btn');
    if (!btn) return;
    btn.textContent = `✅ Will run automatically on ${location.hostname}`;
    btn.disabled = true;
    btn.style.cursor = 'default';
  }
  if (isExtension) {
    try {
      chrome.runtime.onMessage.addListener(onExtensionMessage);
    } catch (e) {}
  }

  // Our buttons sit inside the shop's tiles: stop presses reaching the shop's own handlers
  // (tile links, carousel dragging), not just the click
  const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup'];
  const stopPress = (e) => {
    if (e.target.closest?.('.vf-override-btn, .vf-ok-btn')) e.stopPropagation();
  };
  PRESS_EVENTS.forEach(t => document.addEventListener(t, stopPress, true));

  // Full teardown: also used when the script is pasted again, so old timers/observers can't keep running
  window.__vfTeardown = () => {
    active = false;
    clearTimeout(debounceTimer);
    if (window.__vfObserver) window.__vfObserver.disconnect();
    if (window.__vfClickHandler) document.removeEventListener('click', window.__vfClickHandler, true);
    PRESS_EVENTS.forEach(t => document.removeEventListener(t, stopPress, true));
    if (hasChromeStorage) {
      try {
        chrome.storage.onChanged.removeListener(onStorageChanged);
        chrome.runtime.onMessage.removeListener(onExtensionMessage);
      } catch (e) {}
    }
    uiHost.remove();
    document.getElementById('vf-styles')?.remove();
    document.querySelectorAll('.vf-override-btn, .vf-ok-btn, .vf-badge').forEach(b => b.remove());
    document.querySelectorAll('[data-vf-scanned]').forEach(el => {
      ['data-vf-scanned', 'data-vf-blocked', 'data-vf-maybe', 'data-vf-action', 'data-vf-reason', 'data-vf-title', 'data-vf-diet', 'data-vf-pos'].forEach(a => el.removeAttribute(a));
    });
    window.__vfTeardown = null;
    window.__vfShow = null;
  };

  // 10. Safe Debounced MutationObserver
  // Runs the whole time and ignores our own buttons, badges and UI (so a scan never triggers
  // another one); rescans 250ms after the page settles, but at least once a
  // second on pages that never stop changing (auto-scrolling carousels, live prices).
  const OUR_NODE_SEL = 'veggiefilter-ui, .vf-override-btn, .vf-ok-btn, .vf-badge';
  let firstPendingMutation = 0;
  window.__vfObserver = new MutationObserver((mutations) => {
    const relevant = mutations.some(m => [...m.addedNodes].some(n => n.nodeType === 1 && !n.matches?.(OUR_NODE_SEL) && !n.closest?.('veggiefilter-ui')));
    if (!relevant) return;

    const now = Date.now();
    if (!firstPendingMutation) firstPendingMutation = now;
    clearTimeout(debounceTimer);
    const wait = now - firstPendingMutation > 1000 ? 0 : 250;
    debounceTimer = setTimeout(() => {
      firstPendingMutation = 0;
      scanPage(false);
    }, wait);
  });

  function observeDOM() {
    window.__vfObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 11. Start: the extension waits for saved settings first, so the page never flashes the
  // wrong mode; the console version starts straight away
  function start() {
    if (!active) return;
    document.documentElement.appendChild(uiHost);
    buildWidget();
    // Toolbar icon clicked again while running: bring the widget back and rescan
    window.__vfShow = () => {
      forcedVisible = true;
      memory.minimised = false;
      saveMemory();
      scanPage(true);
    };
    scanPage(true);
    observeDOM();
    console.log('🌱 Herbivore active! A food helper, not a guarantee: always check the label.');
  }

  if (hasChromeStorage) {
    chrome.storage.local.get([STORAGE_KEY, MIGRATED_KEY], (res) => {
      const stored = res?.[STORAGE_KEY];
      // Flags made with the console version live in the shop's own localStorage, which the
      // shop's scripts can write too. So they're brought across once only, and only on the
      // built-in supermarkets (not Amazon, not sites you added).
      const canMigrate = !stored && !res?.[MIGRATED_KEY] && onBuiltInSupermarket();
      const legacy = canMigrate ? readLocalMemory() : null;
      memory = normalizeMemory(stored || legacy);
      // Done once flags have actually been brought across (a shop with nothing to bring
      // doesn't use up the one go)
      if (legacy) chrome.storage.local.set({ [MIGRATED_KEY]: true }).catch(() => {});
      if (legacy) saveMemory();
      chrome.storage.onChanged.addListener(onStorageChanged);
      start();
      if (legacy) showInfoToast('🌱 Brought across your flags from the console version.');
    });
  } else {
    const saved = readLocalMemory();
    if (saved) memory = normalizeMemory(saved);
    start();
  }
})();
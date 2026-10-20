# 🌱 Herbivore: Hide Meat & Dairy While You Shop

A Chrome extension for anyone going veggie or vegan. It **blurs or hides meat and fish** on
UK supermarket websites while you shop, plus **dairy, eggs and honey** in Strictly Vegan mode,
so the food you're avoiding isn't in front of you.

## Why this exists

I built Herbivore because I was trying to go vegetarian and kept getting tempted by all the
meat while shopping online. It's a personal project and it's completely vibe-coded: made with
an AI coding assistant rather than by a professional developer. It works well for me, but
expect rough edges, and please [report anything it gets wrong](https://github.com/DavidModR/herbivore/issues/new/choose).

> **A helper, not a guarantee.** Herbivore decides from product names and the shop's own
> dietary symbols, so it can miss things (gelatine in sweets, animal rennet in cheese) or
> filter things that are fine. Always check the ingredients, especially if you have an allergy.

## Features

- **Blur or hide** products that aren't vegetarian or vegan as you browse
- **Vegetarian and Strictly Vegan modes**, each with its own saved list, so a veggie and a
  vegan can share one computer
- **❓ "Check label" warnings** for things it can't be sure about: gelatine sweets, wine and
  beer, cheeses that may use animal rennet, dark chocolate
- **Reads the shop's own symbols** where shown (Vegan Society roundels, V symbols)
- **Learns from you**: flag anything it missed, show anything it filtered by mistake, or block
  a keyword everywhere
- **Food only**: tissues, cleaning, toiletries and pet food are left alone
- **Help & memory page** with all your saved items, plus backup export and import
- **Private**: no account, no tracking, nothing sent anywhere ([privacy policy](PRIVACY.md))

## Works with

Sainsbury's, Asda, Tesco, Ocado, Morrisons, Waitrose, Aldi and Amazon UK groceries,
automatically. On any other online shop, click the 🌱 toolbar icon to filter that page, and
choose **Always run on this site** if you like. Herbivore is not affiliated with any of these
shops.

## Install

**From the Chrome Web Store:** coming soon.

**From source (for testing):**
1. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. A welcome page opens: choose Vegetarian or Vegan, and Blur or Hide.

## Using it

| Control | What it does |
|---|---|
| Vegetarian / Strictly Vegan | Switches mode. Each mode keeps its own saved list. |
| Action: Blur / Hide | Blur product photos (default), or hide products completely. |
| 🚫 Not Veggie / Not Vegan | Flag a product Herbivore missed (appears when you hover over it). |
| 👁️ Show | Show a product that's actually fine. |
| ✓ Fine | Dismiss a ❓ warning for that product. |
| 🧠 Memory | This mode's saved items, plus backup export and import. |
| ? | Opens the Help & memory page (both modes' saved items, settings, backup). |
| – / ✕ | Minimise the widget / turn it off until the page is reloaded. |
| 🌱 toolbar icon | Filter any site, choose to always run there, open Help & saved items. |

## Found a problem?

- **A product it missed, or one it filtered wrongly?** [Report it here](https://github.com/DavidModR/herbivore/issues/new/choose).
  These reports are how the built-in lists get better.
- **A shop where it doesn't work?** Use the same link and choose "Site not working".
- No GitHub account? Email **herbivore.flashback667@aleeas.com**.

## Development

The extension is plain JavaScript with no dependencies or build tools.

- `extension/content.js` does the filtering on shop pages. It's self-contained: you can also
  paste it straight into a shop page's DevTools console to try it without installing.
- `extension/background.js`, `sites.js`: the toolbar button and "Always run on this site".
- `extension/popup.*`: the toolbar panel. `extension/help.*`: the Help & memory page (also
  the welcome page on first install).
- After changing code, click ↻ on Herbivore in `chrome://extensions`, then reload the shop tab.
- `./build.sh` makes a clean Chrome Web Store ZIP in `dist/`.
- Store listing details (descriptions, permission justifications, privacy answers) are in
  [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).

## Support the project

Herbivore is free. If it's helping, you can [buy me a coffee](https://ko-fi.com/davidrwh). ☕

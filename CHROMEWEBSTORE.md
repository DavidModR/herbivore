# Chrome Web Store Listing — Herbivore

> Last Updated: 2026-10-20

## Store Listing

**Extension Name** [REQUIRED]

Herbivore: Hide Meat & Dairy While You Shop

<!-- 43/75 characters. Matches manifest.json "name". -->

**Short Description** [REQUIRED]

Going veggie or vegan? Hides meat, fish (and dairy in Vegan mode) on UK supermarket sites. A food helper, not a guarantee.

<!-- 122/132 characters. Matches manifest.json "description". -->

**Detailed Description** [REQUIRED]

<!-- Paste as plain text: the store strips markdown. -->

```
Blurs or hides meat and fish on UK supermarket websites as you shop, plus dairy, eggs and honey in Strictly Vegan mode, so the food you're avoiding isn't in front of you.

Going veggie or vegan is hardest in the weekly shop, scrolling past all the meat. Herbivore takes the temptation away.

WHY I MADE IT
I was trying to go vegetarian and kept getting tempted by the meat while shopping online, so I made this. It's a personal, completely vibe-coded project (built with an AI coding assistant), so expect the odd rough edge, and please report anything it gets wrong.

FEATURES
• Blurs product photos (or hides products completely) that aren't vegetarian or vegan
• Vegetarian and Strictly Vegan modes, each with its own saved list, so a veggie and a vegan can share one computer
• "Check label" warnings for things it can't be sure about: gelatine sweets, wine and beer, cheeses that may use animal rennet, dark chocolate
• Uses the shop's own vegetarian and vegan symbols where the shop shows them
• Learns from you: flag anything it missed, show anything it filtered by mistake, or block a keyword everywhere
• Household items (tissues, cleaning, toiletries, pet food) are left alone: it's a food filter
• Help & memory page with all your saved items, plus backup export and import

WORKS WITH
Sainsbury's, Asda, Tesco, Ocado, Morrisons, Waitrose, Aldi and Amazon UK groceries, automatically. On any other online shop, click the toolbar icon to filter that page, and choose "Always run on this site" if you like. Herbivore is not affiliated with any of these shops.

HOW TO USE
1. Install, then choose Vegetarian or Strictly Vegan, and Blur or Hide, on the welcome page
2. Shop as normal on a supported site: matching products are blurred or hidden as you scroll
3. Something slipped through? Hover over it and click "Not Veggie" / "Not Vegan"
4. Something filtered that's fine? Click "Show". A warning that's fine? Click "Fine"
5. Pin the toolbar icon to open Help & your saved items at any time

A HELPER, NOT A GUARANTEE
Herbivore decides from product names and the shop's own symbols, so it can miss things or filter things that are fine. Animal ingredients that aren't in the name (gelatine in sweets, animal rennet in cheese, carmine/E120) may not be caught. Always check the ingredients and the "Suitable for vegetarians/vegans" label, especially if you have an allergy.

PRIVACY
No account, no tracking, no data sent anywhere. Your choices and saved items stay in your browser, and you can export or delete them from the Help & memory page.

PERMISSIONS
• "Read and change your data on" the supported supermarket sites: needed to read product names on the page you're viewing and blur or hide the matching ones. Nothing is sent anywhere.
• Other sites: Herbivore only gets access when you click its icon on that tab, or when you choose "Always run on this site" and approve Chrome's prompt for that one site.

SUPPORT
Found a product it missed, or a site that doesn't work? Report it at https://github.com/DavidModR/herbivore/issues or email herbivore.flashback667@aleeas.com

Version 1.0.0: first release.
```

**Category** [REQUIRED]

Shopping

**Single Purpose** [REQUIRED]

Blurs or hides food products that aren't vegetarian or vegan on supermarket websites, so people following those diets aren't shown them while shopping.

**Primary Language** [REQUIRED]

English (UK)


## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ⬜ Not created | |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ⬜ Not created | |
| Screenshot 4 | 1280×800 | ⬜ Not created | |
| Screenshot 5 | 1280×800 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

### Screenshot Notes
1. A grocery results page with meat products blurred, veggie products untouched, and badges visible.
2. The same page in Hide mode: only suitable products left.
3. A "Check label" warning on an uncertain product (e.g. jelly sweets) with the Fine button.
4. The Help & memory page: settings, saved items, backup.
5. The welcome page (choose Vegetarian/Vegan, Blur/Hide).

Use mock or generic shop pages: no supermarket names, logos or brand colours in screenshots
(trademark rule). Screenshots must match the current UI.


## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| storage | permissions | Saves the user's choices (Vegetarian or Vegan mode, Blur or Hide) and the products and keywords they flag, on their own device, so the filter remembers them across shops and visits. |
| activeTab | permissions | When the user clicks the toolbar icon on a shop that isn't built in, Herbivore can filter that one tab without asking for access to all websites. |
| scripting | permissions | Runs the filter on the tab the user clicked the icon on, and on sites the user explicitly chose to "always run" on. |
| https://www.sainsburys.co.uk/*, https://groceries.asda.com/*, https://www.asda.com/*, https://www.tesco.com/*, https://www.ocado.com/*, https://groceries.morrisons.com/*, https://www.morrisons.com/*, https://www.waitrose.com/*, https://www.aldi.co.uk/*, https://groceries.aldi.co.uk/* | content_scripts (host access) | The filter runs automatically on these UK supermarket websites: it reads product names and the shop's dietary symbols on the page being viewed, and blurs or hides products that aren't vegetarian or vegan. Nothing is sent anywhere. |
| https://www.amazon.co.uk/* | content_scripts (host access) | Filters Amazon UK grocery and Amazon Fresh products. On other Amazon pages it only looks at products priced per kilo or litre (groceries), and does nothing on books, electronics and other departments. |
| https://*/* | optional_host_permissions | Never requested in bulk. Requested for one site at a time, only when the user clicks "Always run on this site" for a shop that isn't built in and approves Chrome's prompt for that site. The user can remove it from the Help page or Chrome's site access settings. |

No remote code: all code ships in the package.


## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

Herbivore reads product names on the shop page being viewed, on the device, to decide what to
filter. It stores only the user's own settings and the items they flag, in the browser's local
extension storage. Nothing is transmitted off the device, and there is no analytics or server.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | No (read on-device only, never stored or sent) | No | — | No |

<!-- Note for the form: diet choice (vegetarian/vegan) and flagged product names are stored
     locally only and never leave the device, so they aren't "collected" in the CWS sense. -->

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes


## Privacy Policy

**Privacy Policy URL** [REQUIRED]

https://github.com/DavidModR/herbivore/blob/main/PRIVACY.md

<!-- Open it in a private window once the repo is public, to check it loads without signing in. -->


## Distribution

**Visibility**: Unlisted for the first week (friends testing), then Public
**Regions**: United Kingdom (the supported shops are UK sites)

## Developer Info

**Publisher Name** [REQUIRED]

David Henderson

**Contact Email** [REQUIRED]

herbivore.flashback667@aleeas.com

<!-- SimpleLogin alias, forwards to the developer's inbox. Google sends policy notices here: keep it switched on. -->

**Support URL / Email** [RECOMMENDED]

https://github.com/DavidModR/herbivore/issues (and herbivore.flashback667@aleeas.com)

**Homepage URL** [RECOMMENDED]

https://github.com/DavidModR/herbivore


## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-10-21 | First release: Vegetarian/Vegan modes, Blur/Hide, "check label" warnings, shop dietary symbols, flags and learned keywords, household skip list, Help & memory page with backup, toolbar "filter this page" and "Always run on this site", Amazon UK groceries. | Draft |


## Review Notes

### Known Issues / Limitations
- Decisions come from product names and shop symbols, not ingredient lists, so some products
  will be missed or filtered wrongly. Stated in the listing, welcome page and help page.
- On very large pages (600+ products at once) the first scan can briefly use the page's
  main thread for ~60–85 ms; changes are applied in small batches between frames.
- Ocado's vegan leaf icon isn't read yet (only its V symbol and generic labels).
- The shop can see the buttons Herbivore adds to its product tiles (e.g. "Not Vegan"), so it
  could infer the mode in use. The widget and saved items are hidden from the page.
- Shop names appear in the description only to say which sites it works with, with "not
  affiliated". Keep them out of the name, icon and screenshots.

### Rejection History
None yet.

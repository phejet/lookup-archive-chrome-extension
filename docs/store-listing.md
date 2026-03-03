# Chrome Web Store Listing — Archive Lookup

---

## Short description

_(132 characters max)_

```
Look up archived snapshots of any link via right-click, or auto-scan pages to see which articles have been preserved.
```

_(118 characters)_

---

## Detailed description

Archive Lookup lets you check whether a web page has been preserved in a web archive, without leaving the page you are reading.

**Right-click any link**
Right-click a link and choose the archive lookup option to open the most recent archived snapshot in a new tab. If a snapshot exists, you land on it immediately. If not, the archive service's search page opens so you can create one.

**Scan a page for archived links**
Right-click the page background and choose "Scan page for archives". The extension checks every visible article link on the page and places a small archive icon next to each one that has a saved snapshot. Click any icon to open that snapshot.

The scanner is smart about what it checks:

- Only links that match the current site's domain are included, so navigation and footer links are ignored.
- Only links that look like articles are checked — short home-page or category links are skipped automatically.
- Duplicate links are deduplicated, so each URL is only checked once.
- Only links visible on screen at the time of the scan are included, so you are not waiting on content you cannot see yet.

**Auto-scan mode**
Auto-scan is enabled by default. Add domains to the allowlist in the extension popup one at a time, or click "Add current site" to add whatever site you are on. Chrome will prompt you to grant permission for each domain. Once a domain is added, the extension scans on page load and re-scans as you scroll down, picking up newly visible links each time you move the viewport by more than a quarter of the screen height.

**Priority-based checking**
When scanning, links closest to the centre of the visible screen are checked first, so the results most relevant to what you are reading appear soonest.

**24-hour cache**
Archive lookups are cached locally for 24 hours. Revisiting pages and re-scanning are fast, and no redundant network requests are made.

**Scan progress**
A progress banner shows live scanning statistics — how many links have been checked, how many snapshots were found, and how long the scan took.

**Minimal permissions**
The extension starts with zero host permissions. When you add a site to the auto-scan allowlist, Chrome prompts you to grant access to that specific domain — and only that domain. Removing a site revokes the permission. Manual scans ("Scan page for archives") work on any page through the `activeTab` permission, which is granted temporarily each time you right-click.

No browsing history is collected or transmitted anywhere other than the archive service you are querying.

**Open source**
The full source code is available on GitHub: https://github.com/phejet/lookup-archive-chrome-extension

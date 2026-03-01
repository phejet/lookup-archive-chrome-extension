# Chrome Web Store — Permissions Justification

## Single Purpose Description

Archive Lookup detects whether links on a page have archived snapshots available on web archive
services, and injects small indicator icons next to links that do, so users can open the archived
version in one click.

---

## Permissions

### `contextMenus`

**Justification:** The extension registers two context-menu items in `background.js`:

- "Look up" context menu item (shown on right-clicking a link) — opens the web archive
  service's "newest" endpoint for the target URL in a new tab, navigating directly to the most
  recent archived snapshot.
- "Scan page for archives" (shown on right-clicking the page) — sends a `scan-page` message to
  the content script, triggering an on-demand scan of all visible article links on the current
  page.

Both menu items are created in the `chrome.runtime.onInstalled` listener and acted upon in the
`chrome.contextMenus.onClicked` listener.

**Without it:** Users would have no way to manually look up a specific link's archived snapshot or
trigger an on-demand page scan. The right-click workflow would not function.

---

### `storage`

**Justification:** The extension uses two storage areas:

- `chrome.storage.local` — used in `background.js` to cache the result of each archive lookup
  (snapshot URL or `null`) together with a timestamp. Cache entries are keyed by the target URL
  (`cache_<url>`) and are considered valid for 24 hours (`CACHE_TTL_MS`). This prevents redundant
  network requests to the web archive service's TimeMap API for URLs that have already been
  checked. The `getCached`, `setCache`, `checkBatch`, and `checkBatchCacheOnly` functions all read
  from and write to this cache.
- `chrome.storage.sync` — used in `content.js` (`init` function) and `popup.js` to persist user
  preferences: `autoScan` (boolean), `autoScanSites` (list of hostnames), `showOnDemandProgress`
  (boolean), and `debugLogging` (boolean). Sync storage allows these settings to roam across the
  user's devices.

**Without it:** Every page load and every scan would re-query the remote API for every link,
causing unnecessary network traffic and making scans significantly slower. User preferences
(auto-scan site list, progress display toggle) would not persist between browser sessions.

---

### `activeTab`

**Justification:** The extension uses `activeTab` in two places:

1. When the user selects "Scan page for archives" from the context menu, `background.js` calls
   `chrome.tabs.sendMessage(tab.id, { action: 'scan-page' })` to instruct the content script in
   the active tab to run a scan. The `activeTab` permission grants the extension temporary access
   to the active tab when invoked via the context menu.

2. In the popup (`popup.js`), the "Add current site" button calls
   `chrome.tabs.query({ active: true, currentWindow: true })` and reads `tabs[0].url` to extract
   the current site's hostname. The `activeTab` permission is required for `tab.url` to be
   populated in the query result.

**Without it:** The context menu scan trigger and the "Add current site" popup button would both
fail. The extension could not determine the active tab's URL or communicate with its content
script when invoked by the user.

---

## Host Permissions

### Web archive service domains (four host patterns)

**Justification:** The four host-permission patterns listed in `manifest.json` are all operational
domains of the same web archive service. The background service worker fetches from two endpoints
on these domains:

1. **TimeMap API** — `background.js` sends `fetch(TIMEMAP_BASE + url)` where `TIMEMAP_BASE` is
   defined as a constant pointing to the service's `/timemap/` path. The response is a link-format
   document listing all mementos for a given URL. The `parseTimemap` function searches this document
   for a line with `rel="last memento"` and extracts the snapshot URL. A 200 response means a
   snapshot exists; 404 means none does.

2. **Newest redirect** — When the user selects the lookup context menu item, `background.js`
   constructs a URL using the service's `/newest/<url>` path and opens it in a new tab. The service
   follows a server-side redirect to the most recent snapshot if one exists.

The `parseTimemap` function also validates that any URL extracted from the TimeMap response has a
hostname matching one of these four domains before returning it, preventing spoofed responses from
injecting arbitrary URLs into the page.

**Without it:** The service worker would be blocked by CORS when attempting to fetch the TimeMap
API, making it impossible to determine whether any archived snapshot exists for a given URL. All
archive lookups would silently fail.

---

## Content Script Match Pattern: `<all_urls>`

**Justification:** The content script (`content.js`) must be able to run on any website the user
visits, because the extension's core feature — scanning the current page for links that have
archived snapshots — is inherently page-agnostic. The user may wish to scan news sites, blogs,
aggregators, or any other page containing article links.

**What the content script actually does on each page:**

1. On load, `init()` reads user preferences from `chrome.storage.sync`. If auto-scan is enabled
   and the current page's hostname is in the user-configured `autoScanSites` allowlist, the script
   begins scanning; otherwise it does nothing. This means the script is entirely passive on pages
   not in the allowlist unless the user explicitly triggers a scan via the context menu.

2. When scanning, `collectNewLinks()` queries the DOM for `<a href>` elements whose `href`
   contains the current page's own hostname, filters to links that are within the viewport, that
   are not wrapping an `<img>` element, and that match article-like URL patterns (e.g. date
   segments, `/article/`, `/story/`, slug-length heuristics). Only matching links are sent to the
   background worker for archive lookup.

3. If a snapshot URL is returned, the script inserts a small `<a>` element with an archive icon
   immediately after the original link (via `insertAdjacentElement('afterend', indicator)`),
   pointing to the archived snapshot. No other DOM modification or data collection occurs.

4. For on-demand scans triggered via the context menu, the content script receives a `scan-page`
   message and executes the same scan flow regardless of the auto-scan allowlist, honouring the
   user's explicit intent.

**A narrower match pattern is not technically feasible** because the set of sites a user may want
to scan is open-ended and user-defined at runtime (via the `autoScanSites` preference), and
on-demand scans can be triggered on any page at any time. The `<all_urls>` pattern is the only way
to support both use cases.

**The script does not read, transmit, or store any page content, user input, or browsing history.**
It only inspects the `href` attributes of anchor elements already present in the DOM for the
purpose of constructing archive lookup requests, and all network requests are made by the
background service worker, not the content script itself.

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
- `chrome.storage.sync` — used in `content.js` (`init` function) and `popup.js` to persist the
  user's auto-scan site allowlist (`autoScanSites`, a list of hostnames). Sync storage allows this
  setting to roam across the user's devices.

**Without it:** Every page load and every scan would re-query the remote API for every link,
causing unnecessary network traffic and making scans significantly slower. User preferences
(auto-scan site list, progress display toggle) would not persist between browser sessions.

---

### `activeTab`

**Justification:** The extension uses `activeTab` in two places:

1. When the user selects "Scan page for archives" from the context menu, `background.js` uses
   `chrome.scripting.executeScript` and `chrome.scripting.insertCSS` to inject the content script
   and stylesheet into the active tab, then sends a `scan-page` message. The `activeTab` permission
   grants temporary host access to the active tab when invoked via the context menu, allowing
   injection without requiring any persistent host permissions.

2. In the popup (`popup.js`), the "Add current site" button calls
   `chrome.tabs.query({ active: true, currentWindow: true })` and reads `tabs[0].url` to extract
   the current site's hostname. The `activeTab` permission is required for `tab.url` to be
   populated in the query result.

**Without it:** The extension could not inject its content script for manual scans (since it has no
persistent host permissions for arbitrary sites), and the "Add current site" popup button could not
read the active tab's URL.

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

### `scripting`

**Justification:** The extension uses the `chrome.scripting` API for two purposes:

1. **On-demand injection** — When the user right-clicks and selects "Scan page for archives",
   `background.js` uses `chrome.scripting.executeScript` and `chrome.scripting.insertCSS` to inject
   the content script and stylesheet into the active tab. The `activeTab` permission (granted by the
   context menu interaction) authorizes this injection without requiring broad host permissions.

2. **Dynamic content script registration** — When the user adds a site to the auto-scan allowlist,
   `background.js` calls `chrome.scripting.registerContentScripts` to register a dynamic content
   script targeting only the allowlisted domains, providing precise, user-controlled domain
   targeting instead of broad host permissions. Registrations use
   `persistAcrossSessions: true` so they survive browser restarts.

**Without it:** The extension could not inject its content script on demand (for manual scans) or
dynamically register content scripts for auto-scan sites at runtime.

---

## Optional Host Permissions

### `optional_host_permissions: ["*://*/*"]`

**Justification:** The extension declares `*://*/*` as an optional host permission so it can
request access to specific sites at runtime when the user adds them to the auto-scan allowlist.
When the user adds a site in the popup, `chrome.permissions.request` prompts the user to grant
access to that specific domain. When the user removes a site, the permission is revoked via
`chrome.permissions.remove`.

This approach means the extension has **zero host permissions by default**. Permissions are
acquired incrementally and only for sites the user explicitly chooses. The browser's permission
prompt ensures the user is always in control.

**What the content script does on auto-scan sites:**

1. On page load, `init()` reads user preferences from `chrome.storage.sync`. If auto-scan is
   enabled and the current page's hostname is in the allowlist, the script scans visible article
   links.

2. `collectNewLinks()` queries the DOM for `<a href>` elements whose `href` contains the current
   page's own hostname, filters to links within the viewport that are not wrapping `<img>` elements
   and that match article-like URL patterns. Only matching links are sent to the background worker
   for archive lookup.

3. If a snapshot URL is returned, a small archive icon is appended to the link. No other DOM
   modification or data collection occurs.

**The script does not read, transmit, or store any page content, user input, or browsing history.**
It only inspects `href` attributes of anchor elements for the purpose of constructing archive
lookup requests.

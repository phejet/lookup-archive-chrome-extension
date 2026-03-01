# Privacy Policy — Archive Lookup

_Last updated: March 1, 2026_

Archive Lookup is a Chrome extension that helps you find archived snapshots of web pages. This policy explains exactly what data the extension accesses, what it stores, and what it sends over the network.

---

## What the extension does

When you use Archive Lookup, it:

- Adds a right-click context menu item to look up an archived snapshot of any link you right-click on.
- Optionally scans pages you visit for links that may have archived snapshots, and adds a small icon next to those links.
- Lets you configure which sites trigger automatic scanning via the extension popup.

---

## Permissions

The extension requests the following Chrome permissions:

| Permission | Why it is needed |
|---|---|
| `contextMenus` | To add the "Look up on archive" and "Scan page for archives" right-click menu items. |
| `storage` | To save your settings (auto-scan toggle, site list, UI preferences) and to cache archive lookup results locally so the same URL is not looked up more than once every 24 hours. |
| `activeTab` | To read the current tab's hostname when you click "Add current site" in the popup, and to send scan messages to the content script. |
| Host permissions for web archive domains | To make network requests to the web archive service's TimeMap API, which is how the extension checks whether a snapshot of a URL exists. Without this, Chrome would block the requests as cross-origin. |

---

## Information collection

**The extension does not collect, transmit, or store any personal data about you.**

No analytics, telemetry, crash reporting, or usage tracking of any kind is included.

The extension does send URLs to a third-party web archive service (see "Third-Party Services" below), but it does not send your identity, IP address (beyond what any normal browser request reveals), or any account information.

---

## Data stored locally

The extension stores two categories of data in your browser using `chrome.storage`:

**Settings (synced across your Chrome profile via `chrome.storage.sync`):**

- Whether automatic scanning is enabled (`autoScan`).
- The list of domain names you have configured for automatic scanning (`autoScanSites`).
- Whether the on-demand scan progress banner is shown (`showOnDemandProgress`).
- Whether debug logging is enabled (`debugLogging`).

These settings sync across devices if you are signed into Chrome with sync enabled. They are controlled entirely by you through the extension popup and can be changed or cleared at any time.

**Lookup cache (stored locally via `chrome.storage.local`):**

When the extension checks whether a URL has an archived snapshot, it caches the result locally for 24 hours. The cache entry contains the URL that was checked, the snapshot URL (if one was found), and a timestamp. Cache entries expire automatically after 24 hours and are then removed. No cache data is ever sent off your device.

---

## Network requests

The extension makes outbound network requests only to a web archive service in the following two situations:

1. **Right-click lookup:** When you right-click a link and choose the lookup option, your browser opens a new tab pointing to the archive service's URL for that link. This is a normal browser navigation — the archive service sees the request just as it would any other visitor.

2. **Archive existence check:** When scanning a page for archived links, the extension's background service worker fetches the archive service's Memento TimeMap API endpoint for each URL it checks. This tells the extension whether a snapshot exists without loading the full archive page. Results are cached locally for 24 hours to minimize repeat requests.

No other outbound requests are made. There is no extension backend, no sync server, and no communication with any server operated by this extension.

---

## Third-party services

The extension interacts with a web archive service that operates under its own terms and privacy policy. When the extension checks whether a URL has been archived, the archive service's servers receive the URL being looked up as part of the HTTP request. The archive service may log this in the same way it logs any other web request.

The extension has no control over the archive service's data practices. You should review the privacy policy of the archive service directly if you have concerns about how it handles request logs.

---

## What the extension does NOT do

- It does not read the content of pages you visit (it only reads the `href` attributes of links already present in the page DOM).
- It does not record your browsing history.
- It does not transmit your settings or site list to any server.
- It does not use cookies.
- It does not include any advertising or analytics code.
- It does not share any data with the extension developer or any third party beyond the archive service requests described above.

---

## Children's privacy

This extension does not knowingly collect any information from anyone, including children.

---

## Changes to this policy

If the extension is updated in a way that changes how it handles data, this policy will be updated. The date at the top of this document reflects when it was last revised. Significant changes will be noted in the extension's release notes.

---

## Contact

If you have questions about this privacy policy or the extension's behavior, please open an issue in the project's repository.

Single Purpose Description:

Archive Lookup checks whether links on a page have archived snapshots on archive.today and shows small icons next to those that do, so users can open the archived version in one click.

contextMenus:

Two right-click menu items: "Look up on Archive.today" (on links) opens the most recent archived snapshot in a new tab, and "Scan page for archives" (on pages) triggers a scan of all visible article links. Without this permission, users would have no way to manually look up or scan.

storage:

Local storage caches archive lookup results with timestamps to avoid redundant API requests. Expired entries are automatically evicted on startup. Sync storage persists the user's auto-scan site allowlist across devices. Without this permission, every scan would re-query the API for every link, and user preferences would not persist.

activeTab:

Used for two things: (1) injecting the content script into the current tab when the user triggers a manual scan via the context menu, and (2) reading the active tab's URL for the "Add current site" button in the popup. Without this, manual scans and the add-current-site feature would not work.

host_permissions (archive.today, archive.is, archive.md, archive.ph):

These four domains are all operated by the same web archive service. The extension fetches the TimeMap API on these domains to check if a URL has archived snapshots, and opens the /newest/ endpoint when the user looks up a link. Extracted snapshot URLs are validated against these domains before use. Without these permissions, the API requests would be blocked by CORS.

scripting:

Used for on-demand content script injection when the user triggers a manual scan via the context menu, and for dynamically registering content scripts on user-allowlisted auto-scan domains. Without this, the extension could not inject into pages for scanning.

optional_host_permissions (`*://*/*`):

The extension has zero host permissions by default. When a user adds a site to their auto-scan allowlist, it requests permission for that specific domain via the browser's permission prompt. When a site is removed, the permission is revoked. On allowlisted sites, the content script scans visible same-site article links, checks each against the archive API, and appends a small icon to links that have snapshots. It does not read, transmit, or store any page content, user input, or browsing history.

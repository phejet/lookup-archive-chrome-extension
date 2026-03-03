# Review Notes — Store Documentation Edits

## Changes made (March 3, 2026)

### Replaced `<all_urls>` with dynamic per-site permissions

The extension no longer declares a `content_scripts` block with `<all_urls>` in `manifest.json`.
Instead it uses:

- **`activeTab`** — grants temporary access when the user right-clicks "Scan page for archives".
  The background script uses `chrome.scripting.executeScript` to inject the content script on
  demand. No broad host permission is needed for manual scans.
- **`optional_host_permissions: ["*://*/*"]`** — when the user adds a site to the auto-scan
  allowlist in the popup, `chrome.permissions.request` prompts for access to that specific domain.
  Removing a site revokes the permission via `chrome.permissions.remove`.
- **`chrome.scripting.registerContentScripts`** — dynamically registers content scripts for only
  the allowlisted domains. Uses `persistAcrossSessions: true` so registrations survive browser
  restarts. Chrome handles injection natively on page load.
- **`scripting` permission** — added to `manifest.json` to enable the above APIs.

All four documentation files were updated to reflect the new permission model:

- **permissions-justification.md**: Replaced the `<all_urls>` content script section with new
  `scripting` and `optional_host_permissions` sections explaining the dynamic registration and
  per-site permission approach.
- **privacy-policy.md**: Updated the permissions table to include `scripting` and optional host
  permissions. Updated the "last updated" date. Clarified that the content script only runs on
  sites the user has explicitly allowed or manually triggered a scan on.
- **store-listing.md**: Replaced the permissions bullet list with a "Minimal permissions"
  paragraph explaining the zero-default-permissions model.
- **review-notes.md**: This file — documents the changes.

### Negative cache TTL reduced

Negative cache entries (URLs with no archived snapshot) now expire after 2 hours instead of 24
hours. This prevents stale "not found" results from persisting after an archive is created.

---

## Changes made (March 1, 2026)

### archive.today name references removed

All three documents were checked for explicit mentions of `archive.today`, `archive.is`,
`archive.md`, and `archive.ph`. The following were found and genericized:

- **store-listing.md**: Changed `"Look up on Archive.today"` to `"the archive lookup option"` in the
  detailed description's right-click section.
- **privacy-policy.md**: Removed the inline example URL `https://archive.is/timemap/<url>` from the
  network requests section, replacing it with a generic reference to the service's Memento TimeMap
  API endpoint.
- **permissions-justification.md**: Three changes:
  1. The `contextMenus` section referred to `"Look up on Archive.today"` by name and included
     `https://archive.today/newest/<url>` -- both replaced with generic descriptions.
  2. The host permissions section header listed all four domains explicitly -- replaced with
     "Web archive service domains (four host patterns)" and directed the reader to `manifest.json`.
  3. The host permissions body included `TIMEMAP_BASE = 'https://archive.is/timemap/'` and
     `https://archive.today/newest/<url>` -- both replaced with generic descriptions of the
     endpoint paths.

### activeTab justification corrected

The permissions-justification.md `activeTab` section originally claimed it was needed for the
context menu handler to obtain `tab.id`. This is inaccurate: the `contextMenus.onClicked` callback
provides the tab object regardless of `activeTab`. The actual need for `activeTab` is:

1. Granting temporary host access to the active tab when the extension is invoked via context menu.
2. Allowing `popup.js` to read `tab.url` from `chrome.tabs.query` results for the "Add current
   site" button.

The section was rewritten to cover both use cases accurately.

### No other issues found

- All permission claims match the actual `manifest.json` entries and code usage.
- Cache TTL, storage areas, and network request descriptions all match the source code.
- The privacy policy covers all data flows and has appropriate sections for children's privacy,
  third-party services, and a "what we do not do" list.
- The short description is within the 132-character limit.

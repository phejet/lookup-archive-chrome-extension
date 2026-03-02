# Review Notes — Store Documentation Edits

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
- The `<all_urls>` content script justification is thorough and accurately describes the filtering
  logic in `collectNewLinks()`.
- Cache TTL, storage areas, and network request descriptions all match the source code.
- The privacy policy covers all data flows and has appropriate sections for children's privacy,
  third-party services, and a "what we do not do" list.
- The short description is within the 132-character limit.

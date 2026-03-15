# Review Notes — Store Documentation Edits

## Changes made (March 15, 2026)

### Extension simplified to single feature

The extension was stripped down to a single feature: right-click any link and choose "Archive Lookup" to open the latest archived snapshot in a new tab.

All scanning, caching, content script injection, auto-scan, and storage functionality was removed.

### Permissions reduced to minimum

The only permission required is `contextMenus`. The following were removed:

- `activeTab`
- `scripting`
- `storage`
- `declarativeNetRequest`
- `optional_host_permissions`
- `host_permissions` (archive service domains)

The extension does not make any network requests itself — it simply opens a new tab with a URL. No host permissions are needed for this.

### Documentation updated

- **permissions-justification.md**: Rewritten to cover only `contextMenus`.
- **privacy-policy.md**: Simplified permissions table, removed storage/caching references, removed network request details (the extension only opens tabs).
- **store-listing.md**: Updated feature list and description to reflect single-feature extension.
- **review-notes.md**: This file — documents the changes.

# Archive.today Lookup — Chrome Extension

A Chrome extension that checks [archive.today](https://archive.today) for archived snapshots of news articles. Useful for reading paywalled content that has already been archived.

## Features

- **Right-click any link → "Look up on Archive.today"** — opens the latest archived snapshot in a new tab
- **Right-click page → "Scan page for archives"** — scans visible article links and adds a small archive icon next to those with available snapshots. Click the icon to open the snapshot.
- **Configurable URL prefixes** — only scans links matching domains you care about (e.g. `afr.com`, `nytimes.com`)
- **Smart filtering** — deduplicates links, skips non-article URLs (homepages, section pages), and only checks links visible on screen
- **24-hour cache** — avoids redundant requests to archive.today

## How it works

The extension uses archive.today's `/newest/<url>` endpoint, which redirects to the most recent snapshot of a given URL. For single lookups it opens this directly in a new tab. For page scans it fetches the endpoint in the background to check if a snapshot exists, then injects indicator icons into the page.

## Install locally

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the project folder
5. The extension icon appears in your toolbar

## Configure

1. Click the extension icon in the toolbar
2. Add URL prefixes for sites you want to scan (e.g. `afr.com`)
3. Navigate to a page with links to those sites
4. Right-click → **"Scan page for archives"** to find archived articles

## Files

```
manifest.json   — Chrome extension manifest (Manifest V3)
background.js   — Service worker: context menus, archive.today lookups, caching
content.js      — Content script: page scanning, link filtering, icon injection
popup.html/js   — Settings popup for managing URL prefixes
styles.css      — Styles for injected archive indicators and status banner
icons/          — Extension icons (16, 48, 128px)
```

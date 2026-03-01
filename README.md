# Archive.today Lookup — Chrome Extension

[![Lint & Format](https://github.com/phejet/lookup-archive-chrome-extension/actions/workflows/lint.yml/badge.svg)](https://github.com/phejet/lookup-archive-chrome-extension/actions/workflows/lint.yml)

A Chrome extension for quickly looking up archived snapshots of web pages on [archive.today](https://archive.today). Handy for researchers, journalists, and anyone who wants to check if a page has been preserved in a web archive.

## Features

- **Right-click any link → "Look up on Archive.today"** — opens the latest archived snapshot in a new tab
- **Right-click page → "Scan page for archives"** — scans visible article links and adds a small archive icon next to those with available snapshots. Click the icon to open the snapshot.
- **Auto-scan** — automatically scans pages on configured sites as they load and as you scroll. Add domains to the allowlist in the extension popup to enable this.
- **Smart filtering** — automatically matches the current site's domain, deduplicates links, skips non-article URLs, and only checks links visible on screen
- **24-hour cache** — avoids redundant requests to archive.today

## How it works

The extension uses archive.today's `/newest/<url>` endpoint, which redirects to the most recent archived snapshot of a given URL. For single lookups it opens this directly in a new tab. For page scans it checks the endpoint in the background and injects small indicator icons next to links that have archived snapshots.

## Install

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the project folder
5. The extension icon appears in your toolbar

## Usage

Right-click any link on a page and select **"Look up on Archive.today"** — if an archived snapshot exists, it opens in a new tab.

For bulk checking, right-click the page background and select **"Scan page for archives"**. It automatically scans links matching the current site's domain. Links with available snapshots get a small archive icon you can click.

### Auto-scan

To have pages scanned automatically without right-clicking:

1. Click the extension icon to open the popup
2. Toggle **Auto-scan** on
3. Add domains to the allowlist (e.g. `nytimes.com`) — type a domain and click **Add**, or click **Add current site**
4. When you visit a page on an allowed domain, visible article links are scanned on load and as you scroll

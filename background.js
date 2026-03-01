const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEWEST_BASE = 'https://archive.today/newest/';
const TIMEMAP_BASE = 'https://archive.is/timemap/';
const ARCHIVE_DOMAINS = ['archive.today', 'archive.is', 'archive.md', 'archive.ph'];
const cacheKey = (url) => 'cache_' + url;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'lookup-archive',
    title: 'Look up on Archive.today',
    contexts: ['link'],
  });
  chrome.contextMenus.create({
    id: 'scan-page',
    title: 'Scan page for archives',
    contexts: ['page'],
  });
  // Clean up stale prefixes from older versions
  chrome.storage.sync.remove('prefixes');
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lookup-archive') {
    // Open archive.today/newest/<url> directly — the browser follows the redirect
    // If a snapshot exists, it lands on the snapshot. If not, archive.today shows a search page.
    const url = info.linkUrl;
    chrome.tabs.create({ url: NEWEST_BASE + url });
  } else if (info.menuItemId === 'scan-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'scan-page' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'check-single') {
    checkArchive(message.url)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }
  if (message.action === 'check-batch') {
    checkBatch(message.urls)
      .then(sendResponse)
      .catch(() => sendResponse({}));
    return true;
  }
  if (message.action === 'check-batch-cache-only') {
    checkBatchCacheOnly(message.urls)
      .then(sendResponse)
      .catch(() => sendResponse({}));
    return true;
  }
});

function readCacheEntry(entry) {
  if (!entry || !('snapshotUrl' in entry)) return undefined;
  if (!entry.snapshotUrl) return null;
  return { url: entry.snapshotUrl, datetime: entry.datetime || null, snapshotCount: entry.snapshotCount || 0 };
}

async function checkBatchCacheOnly(urls) {
  const keys = urls.map(cacheKey);
  const cacheData = await chrome.storage.local.get(keys);
  const now = Date.now();
  const results = {};
  for (const url of urls) {
    const entry = cacheData[cacheKey(url)];
    if (entry && now - entry.timestamp <= CACHE_TTL_MS && 'snapshotUrl' in entry) {
      results[url] = readCacheEntry(entry);
    }
  }
  return results;
}

async function checkBatch(urls) {
  // Fetch all cache entries in a single storage read
  const keys = urls.map(cacheKey);
  const cacheData = await chrome.storage.local.get(keys);
  const now = Date.now();

  const results = {};
  const uncachedUrls = [];

  for (const url of urls) {
    const entry = cacheData[cacheKey(url)];
    if (entry && now - entry.timestamp <= CACHE_TTL_MS && 'snapshotUrl' in entry) {
      results[url] = readCacheEntry(entry);
    } else {
      uncachedUrls.push(url);
    }
  }

  // Only fetch uncached URLs (sequentially to respect rate limits)
  for (const url of uncachedUrls) {
    results[url] = await checkArchive(url);
  }

  return results;
}

function parseTimemap(body) {
  const lines = body.split('\n');
  let snapshotUrl = null;
  let datetime = null;
  let snapshotCount = 0;

  for (const line of lines) {
    // Count all memento entries
    if (/rel="[^"]*memento[^"]*"/.test(line)) {
      snapshotCount++;
    }

    // Find the entry with rel="last memento" or rel="first last memento"
    if (!/rel="[^"]*last memento[^"]*"/.test(line)) continue;
    const urlMatch = line.match(/^<([^>]+)>/);
    if (!urlMatch) continue;
    const candidate = urlMatch[1];
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname;
      if (!ARCHIVE_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d))) continue;
      // Normalize to HTTPS
      parsed.protocol = 'https:';
      snapshotUrl = parsed.href;
      const dtMatch = line.match(/datetime="([^"]+)"/);
      if (dtMatch) datetime = dtMatch[1];
    } catch {
      continue;
    }
  }

  if (!snapshotUrl) return null;
  return { url: snapshotUrl, datetime, snapshotCount };
}

// Check if a URL has an archived snapshot using the Memento TimeMap API.
// archive.is/timemap/<url> returns 200 with link-format data listing all mementos,
// or 404 when no snapshots exist.
async function checkArchive(url) {
  const cached = await getCached(url);
  if (cached !== undefined) return cached;

  let snapshot = null;
  try {
    const response = await fetch(TIMEMAP_BASE + url, {
      signal: AbortSignal.timeout(15000),
    });
    if (response.ok) {
      const body = await response.text();
      snapshot = parseTimemap(body);
    } else if (response.status === 429) {
      return { rateLimited: true };
    }
  } catch (e) {
    console.error('Archive.today lookup failed for', url, e);
  }

  await setCache(url, snapshot);
  return snapshot;
}

async function getCached(url) {
  const key = cacheKey(url);
  const data = await chrome.storage.local.get(key);
  const entry = data[key];
  if (!entry || !('snapshotUrl' in entry)) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return undefined;
  }
  if (!entry.snapshotUrl) return null;
  return { url: entry.snapshotUrl, datetime: entry.datetime || null, snapshotCount: entry.snapshotCount || 0 };
}

async function setCache(url, snapshot) {
  const key = cacheKey(url);
  await chrome.storage.local.set({
    [key]: {
      snapshotUrl: snapshot ? snapshot.url : null,
      datetime: snapshot ? snapshot.datetime : null,
      snapshotCount: snapshot ? snapshot.snapshotCount : 0,
      timestamp: Date.now(),
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cacheKey,
    getCached,
    setCache,
    checkArchive,
    checkBatch,
    checkBatchCacheOnly,
    parseTimemap,
  };
}

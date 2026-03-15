const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours for "not found" results
const NEWEST_BASE = 'https://archive.today/newest/';
const TIMEMAP_BASE = 'https://archive.is/timemap/';
const ARCHIVE_DOMAINS = ['archive.today', 'archive.is', 'archive.md', 'archive.ph'];
const TRANSIENT_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);
const cacheKey = (url) => 'cache_' + url;

async function syncContentScriptRegistrations(sites) {
  await chrome.scripting.unregisterContentScripts({ ids: ['auto-scan'] }).catch(() => {});

  if (sites.length === 0) return;

  const matches = sites.flatMap((site) => [`*://*.${site}/*`, `*://${site}/*`]);
  await chrome.scripting.registerContentScripts([
    {
      id: 'auto-scan',
      matches,
      js: ['content.js'],
      css: ['styles.css'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

chrome.runtime.onInstalled.addListener(async () => {
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

  // Register content scripts for any existing allowlisted sites
  const data = await chrome.storage.sync.get({ autoScan: true, autoScanSites: [] });
  if (data.autoScan && data.autoScanSites.length > 0) {
    await syncContentScriptRegistrations(data.autoScanSites);
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  if (!changes.autoScanSites && !changes.autoScan) return;

  const data = await chrome.storage.sync.get({ autoScan: true, autoScanSites: [] });
  if (data.autoScan && data.autoScanSites.length > 0) {
    await syncContentScriptRegistrations(data.autoScanSites);
    // Inject into already-open tabs that match the new allowlist
    await injectIntoMatchingTabs(data.autoScanSites);
  } else {
    await chrome.scripting.unregisterContentScripts({ ids: ['auto-scan'] }).catch(() => {});
  }
});

async function injectIntoMatchingTabs(sites) {
  const tabs = await chrome.tabs.query({
    url: sites.flatMap((s) => [`*://*.${s}/*`, `*://${s}/*`]),
  });
  for (const tab of tabs) {
    try {
      // Skip if content script is already present
      const alive = await chrome.tabs
        .sendMessage(tab.id, { action: 'ping' })
        .then(() => true)
        .catch(() => false);
      if (alive) {
        // Content script exists — just tell it to re-check settings
        chrome.tabs.sendMessage(tab.id, { action: 'scan-page' }).catch(() => {});
        continue;
      }
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    } catch {
      // Tab may not be injectable (chrome://, etc.)
    }
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lookup-archive') {
    const url = info.linkUrl;
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;
    chrome.tabs.create({ url: NEWEST_BASE + url });
  } else if (info.menuItemId === 'scan-page') {
    if (!tab?.id) return;
    // Check if content script is already injected
    const alreadyInjected = await chrome.tabs
      .sendMessage(tab.id, { action: 'ping' })
      .then(() => true)
      .catch(() => false);

    if (!alreadyInjected) {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });

      // Wait for the content script's message listener to be ready
      for (let i = 0; i < 10; i++) {
        const ready = await chrome.tabs
          .sendMessage(tab.id, { action: 'ping' })
          .then(() => true)
          .catch(() => false);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 50));
      }
    }

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

async function checkBatchCacheOnly(urls) {
  const keys = urls.map(cacheKey);
  const cacheData = await chrome.storage.local.get(keys);
  const now = Date.now();
  const results = {};
  for (const url of urls) {
    const entry = cacheData[cacheKey(url)];
    if (!entry) continue;
    const ttl = entry.snapshotUrl ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (now - entry.timestamp <= ttl) {
      results[url] = entry.snapshotUrl;
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
    if (entry) {
      const ttl = entry.snapshotUrl ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
      if (now - entry.timestamp <= ttl) {
        results[url] = entry.snapshotUrl;
        continue;
      }
    }
    uncachedUrls.push(url);
  }

  // Only fetch uncached URLs (sequentially with delays to respect rate limits)
  for (let i = 0; i < uncachedUrls.length; i++) {
    results[uncachedUrls[i]] = await fetchAndCache(uncachedUrls[i]);
    if (i < uncachedUrls.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return results;
}

function parseTimemap(body) {
  // Find the entry with rel="last memento" or rel="first last memento"
  const lines = body.split('\n');
  for (const line of lines) {
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
      return parsed.href;
    } catch {
      continue;
    }
  }
  return null;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [3000, 6000, 12000];

function isArchiveDomain(hostname) {
  return ARCHIVE_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
}

function parseSnapshotFromArchiveUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    if (!isArchiveDomain(parsed.hostname)) return null;
    if (!/\/\d{14}\//.test(parsed.pathname)) return null;
    parsed.protocol = 'https:';
    return parsed.href;
  } catch {
    return null;
  }
}

function retryDelayForAttempt(attempt) {
  return RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
}

async function fetchViaNewest(url) {
  try {
    const response = await fetch(NEWEST_BASE + url, {
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    if (!response.ok) return null;
    return parseSnapshotFromArchiveUrl(response.url);
  } catch {
    return null;
  }
}

// Fetch a URL's archived snapshot from the Memento TimeMap API and cache the result.
// Only caches definitive answers (200 OK). Rate-limited responses are retried with
// exponential backoff. Errored responses are not cached.
async function fetchAndCache(url) {
  let definitiveNotFound = false;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(TIMEMAP_BASE + url, {
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const body = await response.text();
        const snapshotUrl = parseTimemap(body);
        await setCache(url, snapshotUrl);
        return snapshotUrl;
      }
      if (response.status === 404) {
        definitiveNotFound = true;
        break;
      }
      if (TRANSIENT_STATUSES.has(response.status)) {
        if (attempt < MAX_RETRIES) {
          const delay = retryDelayForAttempt(attempt);
          console.warn(
            'Archive.today transient status',
            response.status,
            'for',
            url,
            '— retrying in',
            delay / 1000,
            's',
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        console.warn(
          'Archive.today transient status',
          response.status,
          'for',
          url,
          '— giving up after',
          MAX_RETRIES,
          'retries',
        );
        break;
      }
      console.warn('Archive.today unexpected status', response.status, 'for', url);
      break;
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        const delay = retryDelayForAttempt(attempt);
        console.warn('Archive.today lookup failed for', url, '— retrying in', delay / 1000, 's', e);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error('Archive.today lookup failed for', url, e);
      break;
    }
  }

  // Fallback path: /newest/ can succeed in cases where timemap is throttled/challenged.
  const fallbackSnapshot = await fetchViaNewest(url);
  if (fallbackSnapshot) {
    await setCache(url, fallbackSnapshot);
    return fallbackSnapshot;
  }

  if (definitiveNotFound) {
    await setCache(url, null);
  }
  return null;
}

// Check if a URL has an archived snapshot, using cache first.
async function checkArchive(url) {
  const cached = await getCached(url);
  if (cached !== undefined) return cached;
  return fetchAndCache(url);
}

async function getCached(url) {
  const key = cacheKey(url);
  const data = await chrome.storage.local.get(key);
  const entry = data[key];
  if (!entry) return undefined;
  const ttl = entry.snapshotUrl ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  if (Date.now() - entry.timestamp > ttl) {
    await chrome.storage.local.remove(key);
    return undefined;
  }
  return entry.snapshotUrl;
}

async function setCache(url, snapshotUrl) {
  const key = cacheKey(url);
  await chrome.storage.local.set({
    [key]: { snapshotUrl, timestamp: Date.now() },
  });
}

const CACHE_PREFIX = 'cache_';

async function evictStaleCache() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const keysToRemove = [];
  for (const [key, entry] of Object.entries(all)) {
    if (!key.startsWith(CACHE_PREFIX)) continue;
    if (!entry || typeof entry.timestamp !== 'number') {
      keysToRemove.push(key);
      continue;
    }
    const ttl = entry.snapshotUrl ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    if (now - entry.timestamp > ttl) {
      keysToRemove.push(key);
    }
  }
  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
  return keysToRemove.length;
}

// Run eviction on service worker startup
evictStaleCache().catch(() => {});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cacheKey,
    getCached,
    setCache,
    checkArchive,
    checkBatch,
    checkBatchCacheOnly,
    parseTimemap,
    syncContentScriptRegistrations,
    injectIntoMatchingTabs,
    evictStaleCache,
    fetchAndCache,
    fetchViaNewest,
    parseSnapshotFromArchiveUrl,
    NEGATIVE_CACHE_TTL_MS,
    MAX_RETRIES,
    RETRY_DELAYS,
  };
}

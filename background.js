const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEWEST_BASE = 'https://archive.today/newest/';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'lookup-archive',
    title: 'Look up on Archive.today',
    contexts: ['link']
  });
  chrome.contextMenus.create({
    id: 'scan-page',
    title: 'Scan page for archives',
    contexts: ['page']
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
  if (message.action === 'check-urls') {
    checkUrlsBatch(message.urls).then(sendResponse);
    return true;
  }
  if (message.action === 'check-single') {
    checkArchive(message.url).then(sendResponse);
    return true;
  }
});

// Check if a URL has an archived snapshot by following the redirect and inspecting the final URL.
// archive.today/newest/<url> redirects to a timestamped snapshot like archive.today/2024/https://...
// If no snapshot exists, the final URL stays on archive.today/newest/ or shows a search/submit page.
async function checkArchive(url) {
  const cached = await getCached(url);
  if (cached !== undefined) return cached;

  let snapshotUrl = null;
  try {
    const response = await fetch(NEWEST_BASE + url, {
      redirect: 'follow',
      headers: { 'Accept': 'text/html' }
    });
    const finalUrl = response.url;
    // A successful snapshot URL contains a timestamp path segment like /2024... or /YYYY
    // and does NOT end with /newest/
    if (response.ok && finalUrl !== NEWEST_BASE + url && !finalUrl.includes('/newest/')) {
      snapshotUrl = finalUrl;
    }
  } catch (e) {
    console.error('Archive.today lookup failed for', url, e);
  }

  await setCache(url, snapshotUrl);
  return snapshotUrl;
}

async function checkUrlsBatch(urls) {
  const results = {};
  for (const url of urls) {
    const wasCached = await isCached(url);
    results[url] = await checkArchive(url);
    // Throttle: 1 request per second (skip delay for cached results)
    if (!wasCached) {
      await sleep(1000);
    }
  }
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCached(url) {
  const key = 'cache_' + url;
  const data = await chrome.storage.local.get(key);
  const entry = data[key];
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return undefined;
  }
  return entry.snapshotUrl;
}

async function isCached(url) {
  const key = 'cache_' + url;
  const data = await chrome.storage.local.get(key);
  const entry = data[key];
  if (!entry) return false;
  return Date.now() - entry.timestamp <= CACHE_TTL_MS;
}

async function setCache(url, snapshotUrl) {
  const key = 'cache_' + url;
  await chrome.storage.local.set({
    [key]: { snapshotUrl, timestamp: Date.now() }
  });
}

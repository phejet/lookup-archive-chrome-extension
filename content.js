const ARCHIVE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="archive-today-icon-svg">
  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v1A1.5 1.5 0 0 1 13.5 5H13v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V5h-.5A1.5 1.5 0 0 1 1 3.5v-1zM2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11zM4 5v8.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5H4zm3 2h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1 0-1z"/>
</svg>`;

// Pre-parse the SVG into a reusable DocumentFragment
const iconTemplate = (() => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(ARCHIVE_ICON_SVG, 'image/svg+xml');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(doc.documentElement);
  return fragment;
})();

const checkedUrls = new Set();
let isAutoScan = false;
let autoScanSites = [];
let showOnDemandProgress = false;
let debugLogging = false;
let currentScanIsManual = false;

function isCurrentSiteAllowed() {
  if (autoScanSites.length === 0) return false;
  const hostname = location.hostname;
  return autoScanSites.some((site) => hostname === site || hostname.endsWith('.' + site));
}

function debugLog(...args) {
  if (debugLogging) console.log('[Archive.today]', ...args);
}

// --- Priority queue + worker pool state ---
const queue = new Map(); // canon -> { url, canon, elements[], state: 'pending'|'in-flight'|'done' }
let activeWorkers = 0;
const MAX_WORKERS = 5;
let stats = { queued: 0, checked: 0, found: 0, notFound: 0, errors: 0 };
let scanStartTime = 0;

// Track fade timeout so we can cancel overlapping fades
let fadeTimeoutId = null;

// --- Status banner (bottom-right, only for on-demand scans) ---
let statusBanner = null;

function getOrCreateBanner() {
  if (statusBanner) return statusBanner;
  statusBanner = document.createElement('div');
  statusBanner.id = 'archive-today-status';
  document.body.appendChild(statusBanner);
  return statusBanner;
}

function showStatus(text) {
  if (!showOnDemandProgress || !currentScanIsManual) return;
  // Cancel any pending fade animation
  if (fadeTimeoutId) {
    fadeTimeoutId.cancel();
    fadeTimeoutId = null;
  }
  const banner = getOrCreateBanner();
  // Clear any lingering animations (fill: 'forwards' keeps opacity: 0)
  banner.getAnimations().forEach((a) => a.cancel());
  banner.textContent = text;
  banner.style.display = 'block';
}

function scheduleFade(delayMs) {
  if (fadeTimeoutId) {
    clearTimeout(fadeTimeoutId);
  }
  // Use the Web Animations API delay instead of setTimeout,
  // since setTimeout can be throttled/killed in content scripts
  if (!statusBanner) return;
  const anim = statusBanner.animate([{ opacity: 0.85 }, { opacity: 0 }], {
    duration: 1000,
    delay: delayMs,
    fill: 'forwards',
  });
  // Store a cancel handle instead of a timeout ID
  fadeTimeoutId = anim;
  anim.onfinish = () => {
    if (statusBanner) statusBanner.style.display = 'none';
    if (fadeTimeoutId === anim) fadeTimeoutId = null;
  };
}

function hideStatus() {
  if (statusBanner) {
    statusBanner.style.display = 'none';
  }
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'scan-page') {
    currentScanIsManual = true;
    // Reset stats for fresh banner on manual scan
    stats = { queued: 0, checked: 0, found: 0, notFound: 0, errors: 0 };
    scanStartTime = performance.now();
    scanPage();
  }
});

// --- URL helpers ---
function canonicalPath(href) {
  try {
    const u = new URL(href);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return href;
  }
}

function isArticleUrl(href) {
  try {
    const u = new URL(href);
    const path = u.pathname;
    const segments = path.split('/').filter((s) => s.length > 0);
    if (segments.length < 2) return false;

    const articlePatterns = [
      /\/\d{4}\/\d{2}\//,
      /\/\d{8}\//,
      /\/article\//,
      /\/story\//,
      /\/news\//,
      /\/opinion\//,
      /\/p\//,
    ];
    if (articlePatterns.some((p) => p.test(path))) return true;

    const lastSegment = segments[segments.length - 1];
    if (lastSegment.includes('-') && lastSegment.length >= 20) return true;
    if (segments.length >= 3) return true;

    return false;
  } catch {
    return false;
  }
}

function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const viewHeight = window.innerHeight;
  const buffer = viewHeight * 0.5;
  return rect.top < viewHeight + buffer && rect.bottom > -buffer;
}

// --- Link collection ---
function collectNewLinks() {
  const prefixes = [location.hostname];
  const allLinks = document.querySelectorAll('a[href]:not(.archive-today-indicator)');
  const urlToElements = new Map();

  for (const link of allLinks) {
    const href = link.href;
    if (!prefixes.some((prefix) => href.includes(prefix))) continue;

    if (!isInViewport(link)) continue;
    if (link.querySelector('img')) continue;
    if (!isArticleUrl(href)) continue;

    const canon = canonicalPath(href);
    if (checkedUrls.has(canon)) continue;

    if (!urlToElements.has(canon)) {
      urlToElements.set(canon, { url: href, elements: [] });
    }
    urlToElements.get(canon).elements.push(link);
  }

  return [...urlToElements.values()];
}

// --- Send message with timeout ---
function sendMessageWithTimeout(msg, timeoutMs = 20000) {
  return Promise.race([
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Message timeout')), timeoutMs)),
  ]);
}

// --- Priority + queue helpers ---

function distanceFromViewportCenter(elements) {
  const centerY = window.innerHeight / 2;
  let minDist = Infinity;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const elCenterY = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(elCenterY - centerY);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function enqueueLinks(entries) {
  let added = 0;
  for (const entry of entries) {
    const canon = canonicalPath(entry.url);
    if (queue.has(canon)) {
      // Merge elements into existing queue item
      const existing = queue.get(canon);
      for (const el of entry.elements) {
        if (!existing.elements.includes(el)) {
          existing.elements.push(el);
        }
      }
    } else {
      queue.set(canon, {
        url: entry.url,
        canon,
        elements: [...entry.elements],
        state: 'pending',
      });
      added++;
      stats.queued++;
    }
  }
  return added;
}

function pickNextItem() {
  let best = null;
  let bestDist = Infinity;
  for (const item of queue.values()) {
    if (item.state !== 'pending') continue;
    const dist = distanceFromViewportCenter(item.elements);
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }
  if (best) {
    best.state = 'in-flight';
    debugLog('Picked item for processing:', best.url, 'distance:', Math.round(bestDist));
  }
  return best;
}

function countPending() {
  let count = 0;
  for (const item of queue.values()) {
    if (item.state === 'pending') count++;
  }
  return count;
}

function countInFlight() {
  let count = 0;
  for (const item of queue.values()) {
    if (item.state === 'in-flight') count++;
  }
  return count;
}

function hasPendingItems() {
  for (const item of queue.values()) {
    if (item.state === 'pending') return true;
  }
  return false;
}

function cleanupDoneItems() {
  for (const [canon, item] of queue) {
    if (item.state === 'done') queue.delete(canon);
  }
}

// --- Inject indicators for a canonical URL ---
function injectIndicatorsForCanon(canon, snapshotUrl) {
  const freshLinks = document.querySelectorAll('a[href]:not(.archive-today-indicator)');
  for (const link of freshLinks) {
    if (link.querySelector('img')) continue;
    if (canonicalPath(link.href) === canon) {
      injectIndicator(link, snapshotUrl);
    }
  }
}

function injectIndicator(link, snapshotUrl) {
  // Check parent for existing indicator with matching href
  if (link.parentElement) {
    const existing = link.parentElement.querySelector(
      `.archive-today-indicator[href="${CSS.escape(snapshotUrl)}"]`,
    );
    if (existing) return;
  }

  const indicator = document.createElement('a');
  indicator.href = snapshotUrl;
  indicator.target = '_blank';
  indicator.rel = 'noopener noreferrer';
  indicator.className = 'archive-today-indicator';
  indicator.title = 'Open archived snapshot';
  indicator.appendChild(iconTemplate.cloneNode(true));
  indicator.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  link.insertAdjacentElement('afterend', indicator);
}

// --- Banner updates ---
function updateBanner() {
  const inFlight = countInFlight();
  const parts = [
    `${stats.checked}/${stats.queued}`,
    `${stats.found} archived`,
    `${stats.notFound} not found`,
  ];
  if (stats.errors > 0) parts.push(`${stats.errors} errors`);
  if (inFlight > 0) parts.push(`${inFlight} checking`);
  showStatus(`Scanning for archived articles... ${parts.join(' | ')}`);
}

function showScanComplete() {
  const elapsed = Math.round(performance.now() - scanStartTime);
  const parts = [
    `${stats.checked} checked`,
    `${stats.found} archived`,
    `${stats.notFound} not found`,
  ];
  if (stats.errors > 0) parts.push(`${stats.errors} errors`);
  parts.push(`${elapsed}ms`);
  const summary = `Scan done: ${parts.join(', ')}`;
  debugLog(summary);
  showStatus(summary);
  scheduleFade(2000);
  currentScanIsManual = false;
}

// --- Worker function ---
async function worker() {
  activeWorkers++;
  debugLog('Worker started. Active workers:', activeWorkers);
  try {
    while (true) {
      const item = pickNextItem();
      if (!item) break;
      try {
        const t0 = performance.now();
        const snapshotUrl = await sendMessageWithTimeout({ action: 'check-single', url: item.url });
        debugLog(
          'check-single took ' +
            Math.round(performance.now() - t0) +
            'ms for ' +
            item.url +
            ' → ' +
            (snapshotUrl ? 'found' : 'not found'),
        );

        checkedUrls.add(item.canon);
        item.state = 'done';

        if (snapshotUrl) {
          stats.found++;
          injectIndicatorsForCanon(item.canon, snapshotUrl);
        } else {
          stats.notFound++;
        }
      } catch (e) {
        console.error('Archive.today scan error for', item.url, e);
        item.state = 'done';
        stats.errors++;
      }
      stats.checked++;
      updateBanner();
    }
  } finally {
    activeWorkers--;
    debugLog('Worker finished. Active workers:', activeWorkers);
    if (activeWorkers === 0 && !hasPendingItems()) {
      showScanComplete();
      cleanupDoneItems();
    }
  }
}

function ensureWorkers() {
  const pending = countPending();
  const toSpawn = Math.min(MAX_WORKERS - activeWorkers, pending);
  debugLog(
    'ensureWorkers: pending=' + pending + ' active=' + activeWorkers + ' spawning=' + toSpawn,
  );
  for (let i = 0; i < toSpawn; i++) {
    worker(); // fire-and-forget
  }
}

// --- Batch cache pre-resolution ---
async function resolveCachedItems() {
  const pendingItems = [];
  for (const item of queue.values()) {
    if (item.state === 'pending') pendingItems.push(item);
  }
  if (pendingItems.length === 0) return;

  const urls = pendingItems.map((item) => item.url);
  try {
    const t0 = performance.now();
    const cached = await sendMessageWithTimeout({ action: 'check-batch-cache-only', urls }, 10000);
    debugLog(
      'Batch cache lookup took ' +
        Math.round(performance.now() - t0) +
        'ms, resolved ' +
        Object.keys(cached).length +
        '/' +
        urls.length +
        ' from cache',
    );

    for (const item of pendingItems) {
      if (item.url in cached) {
        const snapshotUrl = cached[item.url];
        checkedUrls.add(item.canon);
        item.state = 'done';
        stats.checked++;
        if (snapshotUrl) {
          stats.found++;
          injectIndicatorsForCanon(item.canon, snapshotUrl);
        } else {
          stats.notFound++;
        }
      }
    }
    updateBanner();
  } catch (e) {
    debugLog('Batch cache lookup failed, workers will handle all items:', e);
  }
}

// --- Scanning ---
async function scanPage() {
  const entries = collectNewLinks();
  if (entries.length === 0) {
    debugLog('No new links to scan.');
    if (currentScanIsManual && activeWorkers === 0) {
      showStatus('No new article links to scan.');
      scheduleFade(3000);
    }
    return;
  }

  if (scanStartTime === 0) scanStartTime = performance.now();

  const added = enqueueLinks(entries);
  debugLog(
    'Enqueued ' +
      added +
      ' new links (' +
      entries.length +
      ' collected, ' +
      queue.size +
      ' total in queue)',
  );

  if (added === 0) return;

  updateBanner();

  // Batch resolve cached items before spinning up workers
  await resolveCachedItems();

  // If everything was resolved from cache, no workers will spawn
  if (!hasPendingItems() && activeWorkers === 0) {
    showScanComplete();
    cleanupDoneItems();
    return;
  }

  // Spin up workers for remaining uncached items
  ensureWorkers();
}

// --- Scroll detection via scroll event ---
let scrollListening = false;
let lastScanScrollY = 0;

function onScroll() {
  const currentY = window.scrollY;
  const delta = Math.abs(currentY - lastScanScrollY);
  const threshold = window.innerHeight * 0.25;
  if (delta >= threshold) {
    debugLog(
      'Scroll threshold met, triggering scan. delta=' +
        Math.round(delta) +
        ' threshold=' +
        Math.round(threshold) +
        ' checkedTotal=' +
        checkedUrls.size,
    );
    lastScanScrollY = currentY;
    currentScanIsManual = false;
    scanPage();
  }
}

function startScrollDetection() {
  if (scrollListening) return;
  lastScanScrollY = window.scrollY;
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  scrollListening = true;
}

function stopScrollDetection() {
  if (scrollListening) {
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onScroll, { capture: true });
    scrollListening = false;
  }
}

// --- Init ---
async function init() {
  const data = await chrome.storage.sync.get({
    autoScan: false,
    autoScanSites: [],
    showOnDemandProgress: false,
    debugLogging: false,
  });
  isAutoScan = data.autoScan;
  autoScanSites = data.autoScanSites;
  showOnDemandProgress = data.showOnDemandProgress;
  debugLogging = data.debugLogging;
  if (isAutoScan && isCurrentSiteAllowed()) {
    currentScanIsManual = false;
    scanStartTime = performance.now();
    scanPage();
    startScrollDetection();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.autoScanSites) {
      autoScanSites = changes.autoScanSites.newValue;
    }
    if (changes.autoScan || changes.autoScanSites) {
      if (changes.autoScan) isAutoScan = changes.autoScan.newValue;
      if (isAutoScan && isCurrentSiteAllowed()) {
        currentScanIsManual = false;
        scanStartTime = performance.now();
        scanPage();
        startScrollDetection();
      } else {
        stopScrollDetection();
      }
    }
    if (changes.showOnDemandProgress) {
      showOnDemandProgress = changes.showOnDemandProgress.newValue;
      if (!showOnDemandProgress) hideStatus();
    }
    if (changes.debugLogging) {
      debugLogging = changes.debugLogging.newValue;
    }
  }
});

init();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    canonicalPath,
    isArticleUrl,
    isInViewport,
    injectIndicator,
    sendMessageWithTimeout,
  };
}

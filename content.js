const ARCHIVE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="archive-today-icon-svg">
  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v1A1.5 1.5 0 0 1 13.5 5H13v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V5h-.5A1.5 1.5 0 0 1 1 3.5v-1zM2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11zM4 5v8.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5H4zm3 2h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1 0-1z"/>
</svg>`;

// Track which canonical URLs we've already checked (to avoid re-checking on scroll)
const checkedUrls = new Set();
let scanInProgress = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scan-page') {
    scanPage();
  }
});

// Returns canonical URL path (strips query params, fragments, trailing slash)
function canonicalPath(href) {
  try {
    const u = new URL(href);
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return href;
  }
}

// Check if a URL looks like an article (not a section/homepage/utility link)
function isArticleUrl(href) {
  try {
    const u = new URL(href);
    const path = u.pathname;

    // Skip bare homepages and section pages (0-1 meaningful path segments)
    const segments = path.split('/').filter(s => s.length > 0);
    if (segments.length < 2) return false;

    // Common article URL patterns
    const articlePatterns = [
      /\/\d{4}\/\d{2}\//, // date-based: /2024/03/...
      /\/\d{8}\//, // compact date: /20240301/...
      /\/article\//, // explicit article path
      /\/story\//, // story path
      /\/news\//, // news path
      /\/opinion\//, // opinion path
      /\/p\//, // substack-style
    ];
    if (articlePatterns.some(p => p.test(path))) return true;

    // Heuristic: last segment looks like an article slug (contains hyphens, 20+ chars)
    const lastSegment = segments[segments.length - 1];
    if (lastSegment.includes('-') && lastSegment.length >= 20) return true;

    // Has at least 3 path segments (e.g. /section/subsection/article-slug)
    if (segments.length >= 3) return true;

    return false;
  } catch {
    return false;
  }
}

// Check if an element is in or near the current viewport
function isInViewport(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  const viewHeight = window.innerHeight;
  const buffer = viewHeight * 0.5;
  return rect.top < viewHeight + buffer && rect.bottom > -buffer;
}

function getMatchingPrefixes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ prefixes: [] }, (data) => {
      const prefixes = data.prefixes.length > 0 ? data.prefixes : [location.hostname];
      resolve(prefixes);
    });
  });
}

// Collect viewport links that haven't been checked yet
async function collectNewLinks() {
  const prefixes = await getMatchingPrefixes();
  const allLinks = document.querySelectorAll('a[href]');
  const urlToElements = new Map();

  for (const link of allLinks) {
    const href = link.href;
    if (!prefixes.some(prefix => href.includes(prefix))) continue;
    if (!isInViewport(link)) continue;
    if (!isArticleUrl(href)) continue;

    const canon = canonicalPath(href);
    if (checkedUrls.has(canon)) {
      // Already checked — but still inject indicator if this element doesn't have one
      continue;
    }
    if (!urlToElements.has(canon)) {
      urlToElements.set(canon, { url: href, elements: [] });
    }
    urlToElements.get(canon).elements.push(link);
  }

  return [...urlToElements.values()];
}

async function scanPage() {
  if (scanInProgress) {
    console.log('[Archive.today] Scan already in progress, skipping.');
    return;
  }
  scanInProgress = true;

  try {
    const entries = await collectNewLinks();
    console.log(`[Archive.today] Found ${entries.length} new links to check (${checkedUrls.size} already checked).`);
    if (entries.length === 0) {
      scanInProgress = false;
      return;
    }

    for (const entry of entries) {
      const canon = canonicalPath(entry.url);
      try {
        const snapshotUrl = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ action: 'check-single', url: entry.url }, (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          });
        });

        checkedUrls.add(canon);

        if (snapshotUrl) {
          // Inject for the elements we collected, plus any other matching links on the page
          const allLinks = document.querySelectorAll('a[href]');
          for (const link of allLinks) {
            if (canonicalPath(link.href) === canon) {
              injectIndicator(link, snapshotUrl);
            }
          }
        }
      } catch (e) {
        console.error('Archive.today scan error for', entry.url, e);
      }
    }
  } finally {
    scanInProgress = false;
  }
}

function injectIndicator(link, snapshotUrl) {
  if (link.nextElementSibling?.classList.contains('archive-today-indicator')) return;

  const indicator = document.createElement('a');
  indicator.href = snapshotUrl;
  indicator.target = '_blank';
  indicator.rel = 'noopener noreferrer';
  indicator.className = 'archive-today-indicator';
  indicator.title = 'Open archived snapshot';
  indicator.innerHTML = ARCHIVE_ICON_SVG;
  indicator.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  link.insertAdjacentElement('afterend', indicator);
}

// Use a sentinel element with IntersectionObserver to detect viewport changes.
// This works regardless of how the page implements scrolling.
let sentinel = null;
let observer = null;
let pollInterval = null;

function startScrollDetection() {
  // Place a sentinel element at the bottom of the current viewport
  updateSentinel();

  // Poll: check every 1s if viewport has moved significantly
  // This is a simple, reliable fallback that works on all sites
  pollInterval = setInterval(() => {
    // Use a sentinel element's position to detect if viewport changed
    if (!sentinel) return;
    const rect = sentinel.getBoundingClientRect();
    // If the sentinel has scrolled well out of view, the viewport has changed
    if (rect.top < -window.innerHeight * 0.3 || rect.top > window.innerHeight * 1.3) {
      console.log(`[Archive.today] Viewport change detected (sentinel offset: ${Math.round(rect.top)}px). Triggering re-scan.`);
      updateSentinel();
      scanPage();
    }
  }, 1500);

  console.log('[Archive.today] Scroll detection started (polling).');
}

function updateSentinel() {
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.id = 'archive-today-sentinel';
    sentinel.style.cssText = 'position:absolute;width:1px;height:1px;pointer-events:none;opacity:0;z-index:-1;';
    document.body.appendChild(sentinel);
  }
  // Position at the middle of the current viewport
  const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
  sentinel.style.top = (scrollY + window.innerHeight * 0.5) + 'px';
}

function stopScrollDetection() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (sentinel) {
    sentinel.remove();
    sentinel = null;
  }
}

// Initialize auto-scan if enabled
async function initAutoScan() {
  const data = await chrome.storage.sync.get({ autoScan: false });
  console.log('[Archive.today] Auto-scan setting:', data.autoScan);
  if (data.autoScan) {
    console.log('[Archive.today] Auto-scan enabled, running initial scan.');
    scanPage();
    startScrollDetection();
  }
}

// Listen for setting changes (e.g. user toggles auto-scan in popup)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.autoScan) {
    if (changes.autoScan.newValue) {
      scanPage();
      startScrollDetection();
    } else {
      stopScrollDetection();
    }
  }
});

initAutoScan();

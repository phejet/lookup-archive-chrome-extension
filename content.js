const ARCHIVE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="archive-today-icon-svg">
  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v1A1.5 1.5 0 0 1 13.5 5H13v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V5h-.5A1.5 1.5 0 0 1 1 3.5v-1zM2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11zM4 5v8.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5H4zm3 2h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1 0-1z"/>
</svg>`;

const checkedUrls = new Set();
let scanInProgress = false;
let isAutoScan = false;
let showOnDemandProgress = false;
// Track whether current scan was triggered manually (on-demand)
let currentScanIsManual = false;

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
  const banner = getOrCreateBanner();
  banner.textContent = text;
  banner.style.display = 'block';
  banner.style.opacity = '0.85';
}

function fadeAndHideStatus() {
  if (!statusBanner) return;
  const anim = statusBanner.animate(
    [{ opacity: 0.85 }, { opacity: 0 }],
    { duration: 1000, fill: 'forwards' }
  );
  anim.onfinish = () => {
    if (statusBanner) statusBanner.style.display = 'none';
  };
}

function hideStatus() {
  if (statusBanner) {
    statusBanner.style.display = 'none';
  }
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scan-page') {
    currentScanIsManual = true;
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
    const segments = path.split('/').filter(s => s.length > 0);
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
    if (articlePatterns.some(p => p.test(path))) return true;

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
  const allLinks = document.querySelectorAll('a[href]');
  const urlToElements = new Map();

  let totalMatched = 0;
  let skippedViewport = 0;
  let skippedArticle = 0;
  let skippedChecked = 0;

  for (const link of allLinks) {
    const href = link.href;
    if (!prefixes.some(prefix => href.includes(prefix))) continue;
    totalMatched++;

    if (!isInViewport(link)) { skippedViewport++; continue; }
    if (!isArticleUrl(href)) { skippedArticle++; continue; }

    const canon = canonicalPath(href);
    if (checkedUrls.has(canon)) { skippedChecked++; continue; }

    if (!urlToElements.has(canon)) {
      urlToElements.set(canon, { url: href, elements: [] });
    }
    urlToElements.get(canon).elements.push(link);
  }

  console.log(`[Archive.today] Link collection: ${totalMatched} prefix-matched, ${skippedViewport} outside viewport, ${skippedArticle} non-article, ${skippedChecked} already checked, ${urlToElements.size} to scan`);

  return [...urlToElements.values()];
}

// --- Scanning ---
async function scanPage() {
  if (scanInProgress) {
    console.log('[Archive.today] Scan already in progress, skipping.');
    return;
  }
  scanInProgress = true;

  try {
    const entries = collectNewLinks();
    if (entries.length === 0) {
      showStatus('No new article links to scan.');
      setTimeout(fadeAndHideStatus, 3000);
      scanInProgress = false;
      return;
    }

    let checked = 0;
    let found = 0;
    let notFound = 0;

    showStatus(`Scanning ${entries.length} links... (0/${entries.length})`);

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
          found++;
          const allLinks = document.querySelectorAll('a[href]');
          for (const link of allLinks) {
            if (canonicalPath(link.href) === canon) {
              injectIndicator(link, snapshotUrl);
            }
          }
        } else {
          notFound++;
        }
      } catch (e) {
        console.error('Archive.today scan error for', entry.url, e);
        notFound++;
      }

      checked++;
      showStatus(`Scanning... ${checked}/${entries.length} | ${found} archived, ${notFound} not found`);
    }

    const summary = `Scan complete: ${checked} scanned, ${found} archived, ${notFound} not found`;
    console.log(`[Archive.today] ${summary}`);
    showStatus(summary);
    setTimeout(fadeAndHideStatus, 5000);
  } finally {
    scanInProgress = false;
    currentScanIsManual = false;
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

// --- Scroll detection via polling ---
let pollInterval = null;
let lastDocTop = 0;

function startScrollDetection() {
  lastDocTop = document.documentElement.getBoundingClientRect().top;
  console.log(`[Archive.today] Scroll detection started. Initial docTop: ${Math.round(lastDocTop)}px`);

  pollInterval = setInterval(() => {
    const docTop = document.documentElement.getBoundingClientRect().top;
    const delta = Math.abs(docTop - lastDocTop);
    const threshold = window.innerHeight * 0.5;

    if (delta > 10) {
      console.log(`[Archive.today] Poll: docTop=${Math.round(docTop)}, last=${Math.round(lastDocTop)}, delta=${Math.round(delta)}, threshold=${Math.round(threshold)}`);
    }

    if (delta >= threshold) {
      console.log(`[Archive.today] Viewport changed enough. Triggering re-scan.`);
      lastDocTop = docTop;
      currentScanIsManual = false;
      scanPage();
    }
  }, 1500);
}

function stopScrollDetection() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// --- Init ---
async function init() {
  const data = await chrome.storage.sync.get({ autoScan: false, showOnDemandProgress: false });
  isAutoScan = data.autoScan;
  showOnDemandProgress = data.showOnDemandProgress;
  console.log('[Archive.today] Settings:', { autoScan: data.autoScan, showOnDemandProgress: data.showOnDemandProgress });
  console.log('[Archive.today] Page hostname:', location.hostname);
  if (isAutoScan) {
    console.log('[Archive.today] Auto-scan enabled, running initial scan.');
    currentScanIsManual = false;
    scanPage();
    startScrollDetection();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.autoScan) {
      isAutoScan = changes.autoScan.newValue;
      if (isAutoScan) {
        currentScanIsManual = false;
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
  }
});

init();

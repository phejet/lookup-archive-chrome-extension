const ARCHIVE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="archive-today-icon-svg">
  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v1A1.5 1.5 0 0 1 13.5 5H13v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V5h-.5A1.5 1.5 0 0 1 1 3.5v-1zM2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11zM4 5v8.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5H4zm3 2h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1 0-1z"/>
</svg>`;

// Track which canonical URLs we've already checked (to avoid re-checking on scroll)
const checkedUrls = new Set();
let scanInProgress = false;
let showProgress = false;

// --- Status badge (discreet, bottom-right) ---
let statusBadge = null;
let statusExpanded = false;

function getOrCreateBadge() {
  if (statusBadge) return statusBadge;
  statusBadge = document.createElement('div');
  statusBadge.id = 'archive-today-badge';
  statusBadge.addEventListener('click', () => {
    statusExpanded = !statusExpanded;
    statusBadge.classList.toggle('expanded', statusExpanded);
  });
  document.body.appendChild(statusBadge);
  return statusBadge;
}

function updateBadge(text, count) {
  if (!showProgress) return;
  const badge = getOrCreateBadge();
  badge.setAttribute('data-count', count || '');
  badge.setAttribute('data-text', text);
  badge.innerHTML = statusExpanded
    ? `<span class="archive-badge-text">${text}</span>`
    : ARCHIVE_ICON_SVG;
  badge.style.display = 'flex';
}

function hideBadge() {
  if (statusBadge) {
    statusBadge.style.display = 'none';
  }
}

// --- Message listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scan-page') {
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

function getMatchingPrefixes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ prefixes: [] }, (data) => {
      // Always include current site's hostname, plus any configured prefixes
      const prefixes = [location.hostname, ...data.prefixes];
      resolve([...new Set(prefixes)]);
    });
  });
}

// --- Link collection ---
async function collectNewLinks() {
  const prefixes = await getMatchingPrefixes();
  const allLinks = document.querySelectorAll('a[href]');
  const urlToElements = new Map();

  let totalMatched = 0;
  let skippedViewport = 0;
  let skippedArticle = 0;
  let skippedChecked = 0;

  // Debug: sample what link hrefs look like and what we're matching against
  const sampleHrefs = [...allLinks].slice(0, 5).map(l => l.href);
  console.log(`[Archive.today] Prefixes: ${JSON.stringify(prefixes)}, total links: ${allLinks.length}, sample hrefs:`, sampleHrefs);

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
    const entries = await collectNewLinks();
    if (entries.length === 0) {
      scanInProgress = false;
      return;
    }

    let checked = 0;
    let found = 0;

    updateBadge(`Scanning... 0/${entries.length}`, '...');

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
        }
      } catch (e) {
        console.error('Archive.today scan error for', entry.url, e);
      }

      checked++;
      updateBadge(`Scanning... ${checked}/${entries.length} (${found} found)`, found || '...');
    }

    console.log(`[Archive.today] Scan complete: ${found}/${entries.length} archived.`);
    updateBadge(`${found} archived`, found);
    setTimeout(hideBadge, 5000);
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
async function initAutoScan() {
  const data = await chrome.storage.sync.get({ autoScan: false, showProgress: false });
  showProgress = data.showProgress;
  console.log('[Archive.today] Settings:', { autoScan: data.autoScan, showProgress: data.showProgress });
  console.log('[Archive.today] Page hostname:', location.hostname);
  if (data.autoScan) {
    console.log('[Archive.today] Auto-scan enabled, running initial scan.');
    scanPage();
    startScrollDetection();
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.autoScan) {
      if (changes.autoScan.newValue) {
        scanPage();
        startScrollDetection();
      } else {
        stopScrollDetection();
      }
    }
    if (changes.showProgress) {
      showProgress = changes.showProgress.newValue;
      if (!showProgress) hideBadge();
    }
  }
});

initAutoScan();

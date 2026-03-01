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
let scanInProgress = false;
let isAutoScan = false;
let showOnDemandProgress = false;
// Track whether current scan was triggered manually (on-demand)
let currentScanIsManual = false;
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
  banner.getAnimations().forEach(a => a.cancel());
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
  const anim = statusBanner.animate(
    [{ opacity: 0.85 }, { opacity: 0 }],
    { duration: 1000, delay: delayMs, fill: 'forwards' }
  );
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

  for (const link of allLinks) {
    const href = link.href;
    if (!prefixes.some(prefix => href.includes(prefix))) continue;

    if (!isInViewport(link)) continue;
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
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Message timeout')), timeoutMs)
    )
  ]);
}

// --- Scanning ---
async function scanPage() {
  if (scanInProgress) return;
  scanInProgress = true;

  try {
    const entries = collectNewLinks();
    if (entries.length === 0) {
      showStatus('No new article links to scan.');
      scheduleFade(3000);
      scanInProgress = false;
      return;
    }

    let checked = 0;
    let found = 0;
    let notFound = 0;
    let errors = 0;

    showStatus(`Scanning ${entries.length} links... (0/${entries.length})`);

    for (const entry of entries) {
      const canon = canonicalPath(entry.url);
      try {
        const snapshotUrl = await sendMessageWithTimeout({ action: 'check-single', url: entry.url });

        checkedUrls.add(canon);

        if (snapshotUrl) {
          found++;
          // Use elements collected earlier, plus re-query for any added since collection
          const freshLinks = document.querySelectorAll('a[href]');
          for (const link of freshLinks) {
            if (canonicalPath(link.href) === canon) {
              injectIndicator(link, snapshotUrl);
            }
          }
        } else {
          notFound++;
        }
      } catch (e) {
        console.error('Archive.today scan error for', entry.url, e);
        errors++;
      }

      checked++;
      let statusParts = [`${checked}/${entries.length}`, `${found} archived`, `${notFound} not found`];
      if (errors > 0) statusParts.push(`${errors} errors`);
      showStatus(`Scanning... ${statusParts.join(' | ')}`);
    }

    let summaryParts = [`${checked} scanned`, `${found} archived`, `${notFound} not found`];
    if (errors > 0) summaryParts.push(`${errors} errors`);
    showStatus(`Scan complete: ${summaryParts.join(', ')}`);
    scheduleFade(5000);
  } finally {
    scanInProgress = false;
    currentScanIsManual = false;
  }
}

function injectIndicator(link, snapshotUrl) {
  // Check parent for existing indicator with matching href
  if (link.parentElement) {
    const existing = link.parentElement.querySelector(`.archive-today-indicator[href="${CSS.escape(snapshotUrl)}"]`);
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

// --- Scroll detection via scroll event ---
let scrollListening = false;
let lastScrollY = 0;
let scrollTimeout = null;

function onScroll() {
  // Debounce: wait until scrolling stops for 500ms, then check delta
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    const currentY = window.scrollY;
    const delta = Math.abs(currentY - lastScrollY);
    const threshold = window.innerHeight * 0.5;
    if (delta >= threshold) {
      lastScrollY = currentY;
      currentScanIsManual = false;
      scanPage();
    }
  }, 500);
}

function startScrollDetection() {
  if (scrollListening) return;
  lastScrollY = window.scrollY;
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  scrollListening = true;
}

function stopScrollDetection() {
  if (scrollListening) {
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('scroll', onScroll, { capture: true });
    scrollListening = false;
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
      scrollTimeout = null;
    }
  }
}

// --- Init ---
async function init() {
  const data = await chrome.storage.sync.get({ autoScan: false, showOnDemandProgress: false });
  isAutoScan = data.autoScan;
  showOnDemandProgress = data.showOnDemandProgress;
  if (isAutoScan) {
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

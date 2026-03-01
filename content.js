const ARCHIVE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" class="archive-today-icon-svg">
  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v1A1.5 1.5 0 0 1 13.5 5H13v8.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5V5h-.5A1.5 1.5 0 0 1 1 3.5v-1zM2.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-11zM4 5v8.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V5H4zm3 2h2a.5.5 0 0 1 0 1H7a.5.5 0 0 1 0-1z"/>
</svg>`;

let statusBanner = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scan-page') {
    scanPage();
  }
});

function showStatus(text) {
  if (!statusBanner) {
    statusBanner = document.createElement('div');
    statusBanner.id = 'archive-today-status';
    document.body.appendChild(statusBanner);
  }
  statusBanner.textContent = text;
  statusBanner.style.display = 'block';
}

function hideStatus() {
  if (statusBanner) {
    statusBanner.style.display = 'none';
  }
}

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
  // Zero-size elements are hidden
  if (rect.width === 0 && rect.height === 0) return false;

  const viewHeight = window.innerHeight;
  // Include a 50% buffer below the viewport to catch just-off-screen content
  const buffer = viewHeight * 0.5;
  return rect.top < viewHeight + buffer && rect.bottom > -buffer;
}

async function scanPage() {
  // Remove any existing indicators
  document.querySelectorAll('.archive-today-indicator').forEach(el => el.remove());

  const prefixes = await getPrefixes();
  if (prefixes.length === 0) {
    showStatus('No URL prefixes configured. Click the extension icon to add some.');
    setTimeout(hideStatus, 5000);
    return;
  }

  const allLinks = document.querySelectorAll('a[href]');
  const seenPaths = new Set();
  const linksToScan = []; // { url, elements[] }
  const urlToElements = new Map();

  for (const link of allLinks) {
    const href = link.href;
    if (!prefixes.some(prefix => href.includes(prefix))) continue;
    if (!isInViewport(link)) continue;
    if (!isArticleUrl(href)) continue;

    const canon = canonicalPath(href);
    if (!urlToElements.has(canon)) {
      urlToElements.set(canon, { url: href, elements: [] });
    }
    urlToElements.get(canon).elements.push(link);
  }

  const uniqueEntries = [...urlToElements.values()];

  if (uniqueEntries.length === 0) {
    showStatus('No article links matching your prefixes found on this page.');
    setTimeout(hideStatus, 5000);
    return;
  }

  showStatus(`Scanning ${uniqueEntries.length} article links for archives... (0/${uniqueEntries.length})`);

  let checked = 0;
  let found = 0;

  for (const entry of uniqueEntries) {
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

      if (snapshotUrl) {
        found++;
        for (const link of entry.elements) {
          injectIndicator(link, snapshotUrl);
        }
      }
    } catch (e) {
      console.error('Archive.today scan error for', entry.url, e);
    }

    checked++;
    showStatus(`Scanning ${uniqueEntries.length} article links... (${checked}/${uniqueEntries.length}, ${found} found)`);
  }

  showStatus(`Scan complete: ${found} archived link${found !== 1 ? 's' : ''} found out of ${uniqueEntries.length} checked.`);
  setTimeout(hideStatus, 5000);
}

function injectIndicator(link, snapshotUrl) {
  // Don't double-inject
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

function getPrefixes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ prefixes: [] }, (data) => {
      resolve(data.prefixes);
    });
  });
}

const siteInput = document.getElementById('site-input');
const addSiteBtn = document.getElementById('add-site-btn');
const addCurrentSiteBtn = document.getElementById('add-current-site-btn');
const siteListEl = document.getElementById('site-list');
const siteEmptyEl = document.getElementById('site-empty');

let autoScanSites = [];

function normalizeDomain(raw) {
  let domain = raw.trim().toLowerCase();
  // Strip protocol
  domain = domain.replace(/^https?:\/\//, '');
  // Strip path/query/hash
  domain = domain.split('/')[0].split('?')[0].split('#')[0];
  // Strip port
  domain = domain.split(':')[0];
  // Strip www.
  domain = domain.replace(/^www\./, '');
  return domain;
}

function renderSiteList() {
  siteListEl.innerHTML = '';
  siteEmptyEl.style.display = autoScanSites.length === 0 ? 'block' : 'none';
  for (const site of autoScanSites) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = site;
    const btn = document.createElement('button');
    btn.className = 'site-remove';
    btn.textContent = '\u00d7';
    btn.title = 'Remove ' + site;
    btn.addEventListener('click', () => removeSite(site));
    li.appendChild(span);
    li.appendChild(btn);
    siteListEl.appendChild(li);
  }
}

async function addSite(raw) {
  const domain = normalizeDomain(raw);
  if (!domain || domain.length < 3 || !domain.includes('.')) return;
  if (autoScanSites.includes(domain)) return;

  // Save first — permissions.request() may close the popup, so the site
  // must be in storage before the dialog opens.
  autoScanSites.push(domain);
  autoScanSites.sort();
  chrome.storage.sync.set({ autoScanSites });
  renderSiteList();

  const origins = [`*://*.${domain}/*`, `*://${domain}/*`];
  const granted = await chrome.permissions.request({ origins });
  if (!granted) {
    // Popup survived the dialog — undo the save
    autoScanSites = autoScanSites.filter((s) => s !== domain);
    chrome.storage.sync.set({ autoScanSites });
    renderSiteList();
  }
}

async function removeSite(domain) {
  autoScanSites = autoScanSites.filter((s) => s !== domain);
  chrome.storage.sync.set({ autoScanSites });
  renderSiteList();

  const origins = [`*://*.${domain}/*`, `*://${domain}/*`];
  await chrome.permissions.remove({ origins }).catch(() => {});
}

chrome.storage.sync.get({ autoScan: true, autoScanSites: [] }, (data) => {
  autoScanSites = data.autoScanSites;
  renderSiteList();
});

addSiteBtn.addEventListener('click', () => {
  addSite(siteInput.value);
  siteInput.value = '';
});

siteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    addSite(siteInput.value);
    siteInput.value = '';
  }
});

addCurrentSiteBtn.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url) {
      try {
        const hostname = new URL(tabs[0].url).hostname;
        addSite(hostname);
      } catch {
        // ignore invalid URLs
      }
    }
  });
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeDomain, addSite, removeSite, renderSiteList };
}

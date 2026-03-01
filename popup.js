const autoScanToggle = document.getElementById('auto-scan');
const showProgressToggle = document.getElementById('show-progress');
const debugLoggingToggle = document.getElementById('debug-logging');
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

function addSite(raw) {
  const domain = normalizeDomain(raw);
  if (!domain || domain.length < 3 || !domain.includes('.')) return;
  if (autoScanSites.includes(domain)) return;
  autoScanSites.push(domain);
  autoScanSites.sort();
  chrome.storage.sync.set({ autoScanSites });
  renderSiteList();
}

function removeSite(domain) {
  autoScanSites = autoScanSites.filter((s) => s !== domain);
  chrome.storage.sync.set({ autoScanSites });
  renderSiteList();
}

chrome.storage.sync.get(
  { autoScan: false, autoScanSites: [], showOnDemandProgress: false, debugLogging: false },
  (data) => {
    autoScanToggle.checked = data.autoScan;
    showProgressToggle.checked = data.showOnDemandProgress;
    debugLoggingToggle.checked = data.debugLogging;
    autoScanSites = data.autoScanSites;
    renderSiteList();
  },
);

autoScanToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: autoScanToggle.checked });
});

showProgressToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ showOnDemandProgress: showProgressToggle.checked });
});

debugLoggingToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ debugLogging: debugLoggingToggle.checked });
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

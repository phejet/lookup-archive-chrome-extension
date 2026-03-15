import { describe, test, expect, beforeEach } from 'vitest';

let mod;

function setupPopupDOM() {
  document.body.innerHTML = `
    <input type="hidden" id="auto-scan" />
    <input type="hidden" id="show-progress" />
    <input type="hidden" id="debug-logging" />
    <input type="text" id="site-input" />
    <button id="add-site-btn"></button>
    <button id="add-current-site-btn"></button>
    <ul id="site-list"></ul>
    <div id="site-empty" style="display: none"></div>
  `;
}

beforeEach(async () => {
  vi.resetModules();
  setupPopupDOM();

  // Mock chrome.storage.sync.get to call callback with defaults
  chrome.storage.sync.get.mockImplementation((defaults, cb) => {
    if (typeof cb === 'function') cb(defaults);
    return Promise.resolve(defaults);
  });
  chrome.storage.sync.set.mockClear();
  chrome.tabs.query.mockClear();
  chrome.permissions.request.mockReset().mockResolvedValue(true);
  chrome.permissions.remove.mockReset().mockResolvedValue(true);

  mod = await import('../popup.js');
});

describe('normalizeDomain', () => {
  test('strips http protocol', () => {
    expect(mod.normalizeDomain('http://example.com')).toBe('example.com');
  });

  test('strips https protocol', () => {
    expect(mod.normalizeDomain('https://example.com')).toBe('example.com');
  });

  test('strips www prefix', () => {
    expect(mod.normalizeDomain('www.example.com')).toBe('example.com');
  });

  test('strips path', () => {
    expect(mod.normalizeDomain('example.com/path/to/page')).toBe('example.com');
  });

  test('strips query string', () => {
    expect(mod.normalizeDomain('example.com?foo=bar')).toBe('example.com');
  });

  test('strips hash', () => {
    expect(mod.normalizeDomain('example.com#section')).toBe('example.com');
  });

  test('strips port', () => {
    expect(mod.normalizeDomain('example.com:8080')).toBe('example.com');
  });

  test('lowercases domain', () => {
    expect(mod.normalizeDomain('EXAMPLE.COM')).toBe('example.com');
  });

  test('handles full URL with all parts', () => {
    expect(mod.normalizeDomain('https://www.example.com:443/path?q=1#top')).toBe('example.com');
  });

  test('trims whitespace', () => {
    expect(mod.normalizeDomain('  example.com  ')).toBe('example.com');
  });
});

describe('addSite', () => {
  test('adds valid domain to list', async () => {
    await mod.addSite('example.com');
    expect(chrome.permissions.request).toHaveBeenCalledWith({
      origins: ['*://*.example.com/*', '*://example.com/*'],
    });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: ['example.com'],
    });
  });

  test('undoes save when permission denied', async () => {
    chrome.permissions.request.mockResolvedValue(false);
    await mod.addSite('example.com');
    expect(chrome.permissions.request).toHaveBeenCalled();
    // First call saves, second call undoes
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(2);
    expect(chrome.storage.sync.set).toHaveBeenLastCalledWith({
      autoScanSites: [],
    });
  });

  test('rejects domain shorter than 3 chars', async () => {
    await mod.addSite('ab');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('rejects domain without dot', async () => {
    await mod.addSite('localhost');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('rejects empty input', async () => {
    await mod.addSite('');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('does not add duplicate domain', async () => {
    await mod.addSite('example.com');
    chrome.storage.sync.set.mockClear();
    await mod.addSite('example.com');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('normalizes before adding', async () => {
    await mod.addSite('https://www.example.com/section');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: ['example.com'],
    });
  });

  test('keeps list sorted', async () => {
    await mod.addSite('zzz.com');
    await mod.addSite('aaa.com');
    const lastCall = chrome.storage.sync.set.mock.calls.at(-1)[0];
    expect(lastCall.autoScanSites).toEqual(['aaa.com', 'zzz.com']);
  });
});

describe('removeSite', () => {
  test('removes domain from list and revokes permission', async () => {
    await mod.addSite('example.com');
    chrome.storage.sync.set.mockClear();
    await mod.removeSite('example.com');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: [],
    });
    expect(chrome.permissions.remove).toHaveBeenCalledWith({
      origins: ['*://*.example.com/*', '*://example.com/*'],
    });
  });

  test('no-op for domain not in list', async () => {
    await mod.removeSite('notinlist.com');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: [],
    });
  });
});

describe('renderSiteList', () => {
  test('renders site items into DOM', async () => {
    await mod.addSite('example.com');
    await mod.addSite('test.org');

    const items = document.querySelectorAll('#site-list li');
    expect(items.length).toBe(2);

    const texts = [...items].map((li) => li.querySelector('span').textContent);
    expect(texts).toContain('example.com');
    expect(texts).toContain('test.org');
  });

  test('shows empty message when no sites', () => {
    mod.renderSiteList();
    const emptyEl = document.getElementById('site-empty');
    expect(emptyEl.style.display).toBe('block');
  });

  test('hides empty message when sites exist', async () => {
    await mod.addSite('example.com');
    const emptyEl = document.getElementById('site-empty');
    expect(emptyEl.style.display).toBe('none');
  });

  test('remove button removes site on click', async () => {
    await mod.addSite('example.com');
    chrome.storage.sync.set.mockClear();

    const removeBtn = document.querySelector('#site-list .site-remove');
    removeBtn.click();

    // Wait for async removeSite to complete
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: [],
    });
    expect(document.querySelectorAll('#site-list li').length).toBe(0);
  });
});

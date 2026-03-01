import { describe, test, expect, beforeEach } from 'vitest';

let mod;

function setupPopupDOM() {
  document.body.innerHTML = `
    <input type="checkbox" id="auto-scan" />
    <input type="checkbox" id="show-progress" />
    <input type="checkbox" id="debug-logging" />
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
  test('adds valid domain to list', () => {
    mod.addSite('nytimes.com');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: ['nytimes.com'],
    });
  });

  test('rejects domain shorter than 3 chars', () => {
    mod.addSite('ab');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('rejects domain without dot', () => {
    mod.addSite('localhost');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('rejects empty input', () => {
    mod.addSite('');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('does not add duplicate domain', () => {
    mod.addSite('nytimes.com');
    chrome.storage.sync.set.mockClear();
    mod.addSite('nytimes.com');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });

  test('normalizes before adding', () => {
    mod.addSite('https://www.nytimes.com/section');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: ['nytimes.com'],
    });
  });

  test('keeps list sorted', () => {
    mod.addSite('zzz.com');
    mod.addSite('aaa.com');
    const lastCall = chrome.storage.sync.set.mock.calls.at(-1)[0];
    expect(lastCall.autoScanSites).toEqual(['aaa.com', 'zzz.com']);
  });
});

describe('removeSite', () => {
  test('removes domain from list', () => {
    mod.addSite('nytimes.com');
    chrome.storage.sync.set.mockClear();
    mod.removeSite('nytimes.com');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: [],
    });
  });

  test('no-op for domain not in list', () => {
    mod.removeSite('notinlist.com');
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: [],
    });
  });
});

describe('renderSiteList', () => {
  test('renders site items into DOM', () => {
    mod.addSite('example.com');
    mod.addSite('test.org');

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

  test('hides empty message when sites exist', () => {
    mod.addSite('example.com');
    const emptyEl = document.getElementById('site-empty');
    expect(emptyEl.style.display).toBe('none');
  });

  test('remove button removes site on click', () => {
    mod.addSite('example.com');
    chrome.storage.sync.set.mockClear();

    const removeBtn = document.querySelector('#site-list .site-remove');
    removeBtn.click();

    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      autoScanSites: [],
    });
    expect(document.querySelectorAll('#site-list li').length).toBe(0);
  });
});

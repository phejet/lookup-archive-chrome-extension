import { describe, test, expect, beforeEach } from 'vitest';

let mod;

beforeEach(async () => {
  vi.resetModules();
  // Reset chrome mocks
  chrome.storage.local.get.mockResolvedValue({});
  chrome.storage.local.set.mockResolvedValue(undefined);
  chrome.storage.local.remove.mockResolvedValue(undefined);
  chrome.storage.sync.remove.mockResolvedValue(undefined);
  chrome.scripting.registerContentScripts.mockReset().mockResolvedValue(undefined);
  chrome.scripting.unregisterContentScripts.mockReset().mockResolvedValue(undefined);
  chrome.scripting.executeScript.mockReset().mockResolvedValue(undefined);
  chrome.scripting.insertCSS.mockReset().mockResolvedValue(undefined);
  fetch.mockReset();

  mod = await import('../background.js');
});

describe('cacheKey', () => {
  test('prefixes url with cache_', () => {
    expect(mod.cacheKey('https://example.com')).toBe('cache_https://example.com');
  });

  test('handles empty string', () => {
    expect(mod.cacheKey('')).toBe('cache_');
  });
});

describe('getCached', () => {
  test('returns undefined when nothing cached', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    expect(await mod.getCached('https://example.com')).toBeUndefined();
  });

  test('returns snapshotUrl when cache is fresh', async () => {
    const key = mod.cacheKey('https://example.com');
    chrome.storage.local.get.mockResolvedValue({
      [key]: { snapshotUrl: 'https://archive.today/abc', timestamp: Date.now() },
    });
    expect(await mod.getCached('https://example.com')).toBe('https://archive.today/abc');
  });

  test('returns undefined and removes entry when cache is stale', async () => {
    const key = mod.cacheKey('https://example.com');
    const staleTs = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    chrome.storage.local.get.mockResolvedValue({
      [key]: { snapshotUrl: 'https://archive.today/abc', timestamp: staleTs },
    });
    const result = await mod.getCached('https://example.com');
    expect(result).toBeUndefined();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(key);
  });

  test('returns null snapshotUrl for fresh negative cache hit', async () => {
    const key = mod.cacheKey('https://example.com');
    chrome.storage.local.get.mockResolvedValue({
      [key]: { snapshotUrl: null, timestamp: Date.now() },
    });
    expect(await mod.getCached('https://example.com')).toBeNull();
  });

  test('expires negative cache after shorter TTL', async () => {
    const key = mod.cacheKey('https://example.com');
    const staleTs = Date.now() - mod.NEGATIVE_CACHE_TTL_MS - 1000; // just past 2h
    chrome.storage.local.get.mockResolvedValue({
      [key]: { snapshotUrl: null, timestamp: staleTs },
    });
    const result = await mod.getCached('https://example.com');
    expect(result).toBeUndefined();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(key);
  });
});

describe('setCache', () => {
  test('stores snapshotUrl with timestamp', async () => {
    const before = Date.now();
    await mod.setCache('https://example.com', 'https://archive.today/snap');
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    const arg = chrome.storage.local.set.mock.calls[0][0];
    const key = mod.cacheKey('https://example.com');
    expect(arg[key].snapshotUrl).toBe('https://archive.today/snap');
    expect(arg[key].timestamp).toBeGreaterThanOrEqual(before);
    expect(arg[key].timestamp).toBeLessThanOrEqual(Date.now());
  });

  test('stores null snapshotUrl for negative cache', async () => {
    chrome.storage.local.set.mockClear();
    await mod.setCache('https://example.com', null);
    const arg = chrome.storage.local.set.mock.calls[0][0];
    const key = mod.cacheKey('https://example.com');
    expect(arg[key].snapshotUrl).toBeNull();
  });
});

describe('parseTimemap', () => {
  test('extracts last memento URL', () => {
    const body = [
      '<https://example.com>; rel="original",',
      '<https://archive.is/timemap/https://example.com>; rel="self"; type="application/link-format",',
      '<http://archive.md/20260101120000/https://example.com>; rel="first memento"; datetime="Thu, 01 Jan 2026 12:00:00 GMT",',
      '<http://archive.md/20260226181830/https://example.com>; rel="last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"',
    ].join('\n');
    expect(mod.parseTimemap(body)).toBe('https://archive.md/20260226181830/https://example.com');
  });

  test('extracts URL when single memento (first last memento)', () => {
    const body = [
      '<https://example.com>; rel="original",',
      '<http://archive.md/20260226181830/https://example.com>; rel="first last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"',
    ].join('\n');
    expect(mod.parseTimemap(body)).toBe('https://archive.md/20260226181830/https://example.com');
  });

  test('normalizes http to https', () => {
    const body =
      '<http://archive.md/20260226181830/https://example.com>; rel="last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"';
    expect(mod.parseTimemap(body)).toBe('https://archive.md/20260226181830/https://example.com');
  });

  test('returns null when no last memento entry', () => {
    const body = [
      '<https://example.com>; rel="original",',
      '<https://archive.is/timemap/https://example.com>; rel="self"; type="application/link-format"',
    ].join('\n');
    expect(mod.parseTimemap(body)).toBeNull();
  });

  test('returns null for non-archive domain', () => {
    const body =
      '<http://evil.com/20260226181830/https://example.com>; rel="last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"';
    expect(mod.parseTimemap(body)).toBeNull();
  });

  test('returns null for empty body', () => {
    expect(mod.parseTimemap('')).toBeNull();
  });
});

describe('checkArchive', () => {
  const timemapMultiple = [
    '<https://example.com/article>; rel="original",',
    '<https://archive.is/timemap/https://example.com/article>; rel="self"; type="application/link-format",',
    '<http://archive.md/20250101000000/https://example.com/article>; rel="first memento"; datetime="Wed, 01 Jan 2025 00:00:00 GMT",',
    '<http://archive.md/20260226181830/https://example.com/article>; rel="last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"',
  ].join('\n');

  const timemapSingle = [
    '<https://example.com/article>; rel="original",',
    '<http://archive.md/20260226181830/https://example.com/article>; rel="first last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"',
  ].join('\n');

  test('returns snapshot URL with multiple mementos', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(timemapMultiple),
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBe('https://archive.md/20260226181830/https://example.com/article');
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  test('returns snapshot URL with single memento', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(timemapSingle),
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBe('https://archive.md/20260226181830/https://example.com/article');
  });

  test('returns null on 404 (no snapshots)', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBeNull();
  });

  test('returns null on fetch error', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockRejectedValue(new Error('Network error'));
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBeNull();
  });

  test('returns cached value without fetching', async () => {
    const key = mod.cacheKey('https://example.com/article');
    chrome.storage.local.get.mockResolvedValue({
      [key]: { snapshotUrl: 'https://archive.today/cached', timestamp: Date.now() },
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBe('https://archive.today/cached');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('fetches timemap endpoint with correct URL', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(timemapSingle),
    });
    await mod.checkArchive('https://example.com/article');
    expect(fetch).toHaveBeenCalledWith(
      'https://archive.is/timemap/https://example.com/article',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe('checkBatchCacheOnly', () => {
  test('returns only fresh cached entries', async () => {
    const urls = ['https://a.com', 'https://b.com', 'https://c.com'];
    chrome.storage.local.get.mockResolvedValue({
      ['cache_https://a.com']: { snapshotUrl: 'https://archive.today/a', timestamp: Date.now() },
      // b.com not cached
      ['cache_https://c.com']: {
        snapshotUrl: null,
        timestamp: Date.now() - 25 * 60 * 60 * 1000,
      }, // stale
    });
    const results = await mod.checkBatchCacheOnly(urls);
    expect(results['https://a.com']).toBe('https://archive.today/a');
    expect(results['https://b.com']).toBeUndefined();
    expect(results['https://c.com']).toBeUndefined();
  });

  test('expires negative cache entries after shorter TTL', async () => {
    const urls = ['https://a.com'];
    chrome.storage.local.get.mockResolvedValue({
      ['cache_https://a.com']: {
        snapshotUrl: null,
        timestamp: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago (past 2h negative TTL)
      },
    });
    const results = await mod.checkBatchCacheOnly(urls);
    expect(results['https://a.com']).toBeUndefined();
  });

  test('returns empty object when nothing cached', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    const results = await mod.checkBatchCacheOnly(['https://x.com']);
    expect(results).toEqual({});
  });
});

describe('checkBatch', () => {
  test('uses cache for fresh entries and fetches uncached', async () => {
    const cachedKey = mod.cacheKey('https://cached.com');
    const timemap = [
      '<https://uncached.com>; rel="original",',
      '<http://archive.md/20260226181830/https://uncached.com>; rel="first last memento"; datetime="Thu, 26 Feb 2026 18:18:30 GMT"',
    ].join('\n');

    chrome.storage.local.get
      .mockResolvedValueOnce({
        [cachedKey]: { snapshotUrl: 'https://archive.today/c', timestamp: Date.now() },
      })
      .mockResolvedValueOnce({});

    fetch.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(timemap),
    });

    const results = await mod.checkBatch(['https://cached.com', 'https://uncached.com']);
    expect(results['https://cached.com']).toBe('https://archive.today/c');
    expect(results['https://uncached.com']).toBe(
      'https://archive.md/20260226181830/https://uncached.com',
    );
    // fetch should only be called for uncached URL
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('syncContentScriptRegistrations', () => {
  test('unregisters and registers for allowlisted sites', async () => {
    await mod.syncContentScriptRegistrations(['nytimes.com', 'wsj.com']);

    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['auto-scan'],
    });
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalledWith([
      {
        id: 'auto-scan',
        matches: [
          '*://*.nytimes.com/*',
          '*://nytimes.com/*',
          '*://*.wsj.com/*',
          '*://wsj.com/*',
        ],
        js: ['content.js'],
        css: ['styles.css'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  });

  test('only unregisters when sites list is empty', async () => {
    await mod.syncContentScriptRegistrations([]);

    expect(chrome.scripting.unregisterContentScripts).toHaveBeenCalledWith({
      ids: ['auto-scan'],
    });
    expect(chrome.scripting.registerContentScripts).not.toHaveBeenCalled();
  });

  test('does not throw if unregister fails (no existing registration)', async () => {
    chrome.scripting.unregisterContentScripts.mockRejectedValue(new Error('not found'));
    await expect(mod.syncContentScriptRegistrations(['example.com'])).resolves.not.toThrow();
    expect(chrome.scripting.registerContentScripts).toHaveBeenCalled();
  });
});

describe('scan-page context menu handler', () => {
  test('injects content script when ping fails then sends scan-page', async () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    const tab = { id: 42 };

    // First ping fails (no content script), then post-injection ping succeeds
    chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error('no receiver'))
      .mockResolvedValueOnce({ pong: true })
      .mockResolvedValueOnce(undefined);

    await clickHandler({ menuItemId: 'scan-page' }, tab);

    expect(chrome.scripting.insertCSS).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['styles.css'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['content.js'],
    });
    // Last sendMessage call is scan-page
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42, { action: 'scan-page' });
  });

  test('skips injection when ping succeeds', async () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    const tab = { id: 42 };

    // Ping succeeds — content script already injected
    chrome.tabs.sendMessage.mockResolvedValueOnce({ pong: true });

    await clickHandler({ menuItemId: 'scan-page' }, tab);

    expect(chrome.scripting.insertCSS).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42, { action: 'scan-page' });
  });
});

describe('injectIntoMatchingTabs', () => {
  test('injects into open tabs that match sites and have no content script', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 10 }, { id: 20 }]);
    // Tab 10: no content script (ping fails), Tab 20: already has content script
    chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error('no receiver'))
      .mockResolvedValueOnce({ pong: true })
      .mockResolvedValue(undefined);

    await mod.injectIntoMatchingTabs(['nytimes.com']);

    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: ['*://*.nytimes.com/*', '*://nytimes.com/*'],
    });
    // Tab 10 gets injected
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 10 },
      files: ['content.js'],
    });
    // Tab 20 gets a scan-page message instead
    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  test('does not throw on non-injectable tabs', async () => {
    chrome.tabs.query.mockResolvedValue([{ id: 99 }]);
    chrome.tabs.sendMessage.mockRejectedValue(new Error('no receiver'));
    chrome.scripting.executeScript.mockRejectedValue(new Error('cannot access'));

    await expect(mod.injectIntoMatchingTabs(['example.com'])).resolves.not.toThrow();
  });
});

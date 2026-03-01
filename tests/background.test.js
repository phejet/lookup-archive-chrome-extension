import { describe, test, expect, beforeEach } from 'vitest';

let mod;

beforeEach(async () => {
  vi.resetModules();
  // Reset chrome mocks
  chrome.storage.local.get.mockResolvedValue({});
  chrome.storage.local.set.mockResolvedValue(undefined);
  chrome.storage.local.remove.mockResolvedValue(undefined);
  chrome.storage.sync.remove.mockResolvedValue(undefined);
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

  test('returns null snapshotUrl for negative cache hit', async () => {
    const key = mod.cacheKey('https://example.com');
    chrome.storage.local.get.mockResolvedValue({
      [key]: { snapshotUrl: null, timestamp: Date.now() },
    });
    expect(await mod.getCached('https://example.com')).toBeNull();
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

describe('extractSnapshotUrl', () => {
  test('extracts URL from meta-refresh redirect', () => {
    const html =
      '<html><head><meta http-equiv="refresh" content="0;url=https://archive.today/2024/https://example.com"></head></html>';
    expect(mod.extractSnapshotUrl(html)).toBe(
      'https://archive.today/2024/https://example.com',
    );
  });

  test('extracts URL from location.href assignment', () => {
    const html = '<script>location.href = "https://archive.is/abc123";</script>';
    expect(mod.extractSnapshotUrl(html)).toBe('https://archive.is/abc123');
  });

  test('extracts URL from location.replace()', () => {
    const html = '<script>location.replace("https://archive.ph/2025/https://example.com");</script>';
    expect(mod.extractSnapshotUrl(html)).toBe(
      'https://archive.ph/2025/https://example.com',
    );
  });

  test('returns null for search/submit page with no snapshot', () => {
    const html =
      '<html><body><form action="/submit"><input name="url"></form></body></html>';
    expect(mod.extractSnapshotUrl(html)).toBeNull();
  });

  test('returns null when redirect targets non-archive domain', () => {
    const html = '<script>location.href = "https://evil.com/2024/https://example.com";</script>';
    expect(mod.extractSnapshotUrl(html)).toBeNull();
  });

  test('returns null when redirect URL contains /newest/', () => {
    const html =
      '<meta http-equiv="refresh" content="0;url=https://archive.today/newest/https://example.com">';
    expect(mod.extractSnapshotUrl(html)).toBeNull();
  });
});

describe('checkArchive', () => {
  test('returns snapshot URL on valid redirect', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://archive.today/2024/https://example.com/article',
      text: vi.fn().mockResolvedValue(''),
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBe('https://archive.today/2024/https://example.com/article');
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });

  test('returns null when no snapshot (stays on /newest/)', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://archive.today/newest/https://example.com/article',
      text: vi.fn().mockResolvedValue('<html><body>No results</body></html>'),
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

  test('rejects non-archive domains in final URL', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://evil.com/2024/https://example.com/article',
      text: vi.fn().mockResolvedValue(''),
    });
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

  test('accepts all known archive domains', async () => {
    for (const domain of ['archive.today', 'archive.is', 'archive.md', 'archive.ph']) {
      vi.resetModules();
      chrome.storage.local.get.mockResolvedValue({});
      fetch.mockResolvedValue({
        ok: true,
        url: `https://${domain}/2024/https://example.com`,
        text: vi.fn().mockResolvedValue(''),
      });
      const freshMod = await import('../background.js');
      const result = await freshMod.checkArchive('https://example.com');
      expect(result).toBe(`https://${domain}/2024/https://example.com`);
    }
  });

  test('falls back to meta-refresh body parsing when URL check fails', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    const html =
      '<html><head><meta http-equiv="refresh" content="0;url=https://archive.today/2024/https://example.com/article"></head></html>';
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://archive.today/newest/https://example.com/article',
      text: vi.fn().mockResolvedValue(html),
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBe('https://archive.today/2024/https://example.com/article');
  });

  test('falls back to JS redirect body parsing when URL check fails', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    const html = '<script>location.href = "https://archive.is/abc123";</script>';
    fetch.mockResolvedValue({
      ok: true,
      url: 'https://archive.today/newest/https://example.com/article',
      text: vi.fn().mockResolvedValue(html),
    });
    const result = await mod.checkArchive('https://example.com/article');
    expect(result).toBe('https://archive.is/abc123');
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

  test('returns empty object when nothing cached', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    const results = await mod.checkBatchCacheOnly(['https://x.com']);
    expect(results).toEqual({});
  });
});

describe('checkBatch', () => {
  test('uses cache for fresh entries and fetches uncached', async () => {
    const cachedKey = mod.cacheKey('https://cached.com');
    // First call: batch get (checkBatch reads all keys)
    // Second call: getCached inside checkArchive for uncached.com
    chrome.storage.local.get
      .mockResolvedValueOnce({
        [cachedKey]: { snapshotUrl: 'https://archive.today/c', timestamp: Date.now() },
      })
      .mockResolvedValueOnce({});

    fetch.mockResolvedValue({
      ok: true,
      url: 'https://archive.today/2024/https://uncached.com',
      text: vi.fn().mockResolvedValue(''),
    });

    const results = await mod.checkBatch(['https://cached.com', 'https://uncached.com']);
    expect(results['https://cached.com']).toBe('https://archive.today/c');
    expect(results['https://uncached.com']).toBe(
      'https://archive.today/2024/https://uncached.com',
    );
    // fetch should only be called for uncached URL
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

import { describe, test, expect, beforeEach } from 'vitest';

let mod;

beforeEach(async () => {
  vi.resetModules();
  // Reset chrome mocks to prevent side effects from init()
  chrome.storage.sync.get.mockImplementation((defaults, cb) => {
    if (typeof cb === 'function') cb(defaults);
    return Promise.resolve(defaults);
  });
  chrome.storage.onChanged.addListener.mockClear();
  chrome.runtime.onMessage.addListener.mockClear();

  mod = await import('../content.js');
});

describe('canonicalPath', () => {
  test('strips trailing slashes', () => {
    expect(mod.canonicalPath('https://example.com/path/')).toBe('https://example.com/path');
  });

  test('strips multiple trailing slashes', () => {
    expect(mod.canonicalPath('https://example.com/path///')).toBe('https://example.com/path');
  });

  test('strips query string', () => {
    expect(mod.canonicalPath('https://example.com/path?foo=bar')).toBe('https://example.com/path');
  });

  test('strips hash', () => {
    expect(mod.canonicalPath('https://example.com/path#section')).toBe('https://example.com/path');
  });

  test('strips query and hash together', () => {
    expect(mod.canonicalPath('https://example.com/path?a=1#top')).toBe('https://example.com/path');
  });

  test('returns href as-is for invalid URL', () => {
    expect(mod.canonicalPath('not-a-url')).toBe('not-a-url');
  });

  test('preserves origin for root path', () => {
    expect(mod.canonicalPath('https://example.com/')).toBe('https://example.com');
  });
});

describe('isArticleUrl', () => {
  test('matches date patterns /YYYY/MM/', () => {
    expect(mod.isArticleUrl('https://nyt.com/2024/01/some-article')).toBe(true);
  });

  test('matches /YYYYMMDD/ pattern', () => {
    expect(mod.isArticleUrl('https://site.com/20240115/headline')).toBe(true);
  });

  test('matches /article/ path', () => {
    expect(mod.isArticleUrl('https://site.com/article/headline-slug')).toBe(true);
  });

  test('matches /story/ path', () => {
    expect(mod.isArticleUrl('https://site.com/story/headline-slug')).toBe(true);
  });

  test('matches /news/ path', () => {
    expect(mod.isArticleUrl('https://site.com/news/headline-slug')).toBe(true);
  });

  test('matches /opinion/ path', () => {
    expect(mod.isArticleUrl('https://site.com/opinion/headline-slug')).toBe(true);
  });

  test('matches /p/ path (Substack)', () => {
    expect(mod.isArticleUrl('https://sub.substack.com/p/some-post-slug')).toBe(true);
  });

  test('matches long slug with hyphens', () => {
    expect(mod.isArticleUrl('https://site.com/section/this-is-a-long-article-headline')).toBe(true);
  });

  test('matches paths with 3+ segments', () => {
    expect(mod.isArticleUrl('https://site.com/a/b/c')).toBe(true);
  });

  test('rejects root path', () => {
    expect(mod.isArticleUrl('https://example.com/')).toBe(false);
  });

  test('rejects single shallow segment', () => {
    expect(mod.isArticleUrl('https://example.com/about')).toBe(false);
  });

  test('rejects short two-segment path without pattern', () => {
    expect(mod.isArticleUrl('https://example.com/section/short')).toBe(false);
  });

  test('rejects invalid URL', () => {
    expect(mod.isArticleUrl('not-a-url')).toBe(false);
  });
});

describe('isInViewport', () => {
  test('returns true for element in viewport', () => {
    // jsdom defaults window.innerHeight to 768
    const el = { getBoundingClientRect: () => ({ top: 100, bottom: 200, width: 100, height: 50 }) };
    expect(mod.isInViewport(el)).toBe(true);
  });

  test('returns false for zero-size element', () => {
    const el = { getBoundingClientRect: () => ({ top: 100, bottom: 100, width: 0, height: 0 }) };
    expect(mod.isInViewport(el)).toBe(false);
  });

  test('returns false for element far below viewport', () => {
    const el = {
      getBoundingClientRect: () => ({ top: 5000, bottom: 5050, width: 100, height: 50 }),
    };
    expect(mod.isInViewport(el)).toBe(false);
  });

  test('returns true for element within buffer zone below viewport', () => {
    // buffer = innerHeight * 0.5 = 384
    const el = {
      getBoundingClientRect: () => ({ top: 900, bottom: 950, width: 100, height: 50 }),
    };
    expect(mod.isInViewport(el)).toBe(true);
  });

  test('returns false for element far above viewport', () => {
    const el = {
      getBoundingClientRect: () => ({ top: -5000, bottom: -4950, width: 100, height: 50 }),
    };
    expect(mod.isInViewport(el)).toBe(false);
  });
});

describe('parseSnapshotDate', () => {
  test('parses 14-digit timestamp from archive URL', () => {
    const date = mod.parseSnapshotDate('https://archive.md/20260226181830/https://example.com');
    expect(date).toBeInstanceOf(Date);
    expect(date.toISOString()).toBe('2026-02-26T18:18:30.000Z');
  });

  test('returns null for URL without timestamp', () => {
    expect(mod.parseSnapshotDate('https://archive.today/snap')).toBeNull();
  });

  test('returns null for URL with short numeric path', () => {
    expect(mod.parseSnapshotDate('https://archive.md/12345/')).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  test('returns "just now" for very recent dates', () => {
    const now = new Date();
    expect(mod.formatRelativeTime(now)).toBe('just now');
  });

  test('returns minutes ago', () => {
    const date = new Date(Date.now() - 5 * 60 * 1000);
    expect(mod.formatRelativeTime(date)).toBe('5 minutes ago');
  });

  test('returns "1 hour ago" for singular', () => {
    const date = new Date(Date.now() - 61 * 60 * 1000);
    expect(mod.formatRelativeTime(date)).toBe('1 hour ago');
  });

  test('returns days ago', () => {
    const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(mod.formatRelativeTime(date)).toBe('3 days ago');
  });

  test('returns months ago', () => {
    const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    expect(mod.formatRelativeTime(date)).toBe('2 months ago');
  });

  test('returns years ago', () => {
    const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(mod.formatRelativeTime(date)).toBe('1 year ago');
  });

  test('returns "just now" for future dates', () => {
    const date = new Date(Date.now() + 60000);
    expect(mod.formatRelativeTime(date)).toBe('just now');
  });
});

describe('injectIndicator', () => {
  test('appends indicator with dynamic tooltip for timestamped URL', () => {
    const container = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://example.com/article';
    link.textContent = 'Article headline';
    container.appendChild(link);

    mod.injectIndicator(link, 'https://archive.md/20260226181830/https://example.com/article');

    const indicator = link.querySelector('.archive-today-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator.href).toContain('archive.md/20260226181830');
    expect(indicator.target).toBe('_blank');
    expect(indicator.rel).toBe('noopener noreferrer');
    expect(indicator.title).toMatch(/^Archived /);
    expect(indicator.title).not.toBe('Open archived snapshot');
  });

  test('falls back to static tooltip for URL without timestamp', () => {
    const container = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://example.com/article';
    container.appendChild(link);

    mod.injectIndicator(link, 'https://archive.today/snap');

    const indicator = link.querySelector('.archive-today-indicator');
    expect(indicator.title).toBe('Open archived snapshot');
  });

  test('does not duplicate indicator', () => {
    const container = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://example.com/article';
    container.appendChild(link);

    mod.injectIndicator(link, 'https://archive.today/snap');
    mod.injectIndicator(link, 'https://archive.today/snap2');

    const indicators = link.querySelectorAll('.archive-today-indicator');
    expect(indicators.length).toBe(1);
  });

  test('re-injects indicator on re-rendered link after URL was already checked', async () => {
    // First render: indicator is present
    document.body.innerHTML = `
      <a id="old" href="https://example.com/news/some-article-slug">Old article</a>
    `;
    const oldLink = document.getElementById('old');
    mod.injectIndicator(
      oldLink,
      'https://archive.md/20260226181830/https://example.com/news/some-article-slug',
    );
    expect(oldLink.querySelector('.archive-today-indicator')).not.toBeNull();

    // Simulate feed re-render: old node removed, fresh node inserted
    document.body.innerHTML = `
      <a id="new" href="https://example.com/news/some-article-slug">New article</a>
    `;
    const newLink = document.getElementById('new');
    mod.injectIndicator(
      newLink,
      'https://archive.md/20260226181830/https://example.com/news/some-article-slug',
    );
    expect(newLink.querySelector('.archive-today-indicator')).not.toBeNull();
  });
});

describe('sendMessageWithTimeout', () => {
  test('resolves with response from chrome.runtime.sendMessage', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      chrome.runtime.lastError = null;
      cb({ result: 'ok' });
    });
    const result = await mod.sendMessageWithTimeout({ action: 'test' });
    expect(result).toEqual({ result: 'ok' });
  });

  test('rejects on chrome.runtime.lastError', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      chrome.runtime.lastError = { message: 'Extension context invalidated' };
      cb(undefined);
      chrome.runtime.lastError = null;
    });
    await expect(mod.sendMessageWithTimeout({ action: 'test' })).rejects.toEqual({
      message: 'Extension context invalidated',
    });
  });

  test('rejects on timeout', async () => {
    chrome.runtime.sendMessage.mockImplementation(() => {
      // never call callback
    });
    await expect(mod.sendMessageWithTimeout({ action: 'test' }, 50)).rejects.toThrow(
      'Message timeout',
    );
  });
});

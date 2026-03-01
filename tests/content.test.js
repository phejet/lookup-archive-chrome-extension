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
    expect(mod.canonicalPath('https://example.com/path?foo=bar')).toBe(
      'https://example.com/path',
    );
  });

  test('strips hash', () => {
    expect(mod.canonicalPath('https://example.com/path#section')).toBe(
      'https://example.com/path',
    );
  });

  test('strips query and hash together', () => {
    expect(mod.canonicalPath('https://example.com/path?a=1#top')).toBe(
      'https://example.com/path',
    );
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
    expect(mod.isArticleUrl('https://site.com/section/this-is-a-long-article-headline')).toBe(
      true,
    );
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

describe('injectIndicator', () => {
  test('inserts indicator element after the link', () => {
    const container = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://example.com/article';
    container.appendChild(link);

    mod.injectIndicator(link, 'https://archive.today/snap');

    const indicator = container.querySelector('.archive-today-indicator');
    expect(indicator).not.toBeNull();
    expect(indicator.href).toBe('https://archive.today/snap');
    expect(indicator.target).toBe('_blank');
    expect(indicator.rel).toBe('noopener noreferrer');
  });

  test('does not duplicate indicator with same href', () => {
    const container = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://example.com/article';
    container.appendChild(link);

    mod.injectIndicator(link, 'https://archive.today/snap');
    mod.injectIndicator(link, 'https://archive.today/snap');

    const indicators = container.querySelectorAll('.archive-today-indicator');
    expect(indicators.length).toBe(1);
  });

  test('allows different snapshot URLs for same link', () => {
    const container = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://example.com/article';
    container.appendChild(link);

    mod.injectIndicator(link, 'https://archive.today/snap1');
    mod.injectIndicator(link, 'https://archive.today/snap2');

    const indicators = container.querySelectorAll('.archive-today-indicator');
    expect(indicators.length).toBe(2);
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

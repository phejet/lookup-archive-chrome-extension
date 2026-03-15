import { describe, test, expect, beforeEach } from 'vitest';

beforeEach(async () => {
  vi.resetModules();
  chrome.contextMenus.onClicked.addListener.mockClear();
  chrome.contextMenus.create.mockClear();
  chrome.runtime.onInstalled.addListener.mockClear();
  chrome.tabs.create.mockClear();

  await import('../background.js');
});

describe('onInstalled', () => {
  test('creates lookup-archive context menu item', () => {
    const installHandler = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
    installHandler();
    expect(chrome.contextMenus.create).toHaveBeenCalledWith({
      id: 'lookup-archive',
      title: 'Archive Lookup',
      contexts: ['link'],
    });
  });
});

describe('context menu click handler', () => {
  test('opens newest archive URL in new tab', () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    clickHandler({ menuItemId: 'lookup-archive', linkUrl: 'https://example.com/page' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://archive.today/newest/https://example.com/page',
    });
  });

  test('ignores non-http links', () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    clickHandler({ menuItemId: 'lookup-archive', linkUrl: 'javascript:void(0)' });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('ignores missing linkUrl', () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    clickHandler({ menuItemId: 'lookup-archive' });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('ignores unknown menu item', () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    clickHandler({ menuItemId: 'something-else', linkUrl: 'https://example.com' });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  test('handles http links', () => {
    const clickHandler = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    clickHandler({ menuItemId: 'lookup-archive', linkUrl: 'http://example.com/page' });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://archive.today/newest/http://example.com/page',
    });
  });
});

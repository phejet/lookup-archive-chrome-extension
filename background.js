const NEWEST_BASE = 'https://archive.today/newest/';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'lookup-archive',
    title: 'Archive Lookup',
    contexts: ['link'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'lookup-archive') return;
  const url = info.linkUrl;
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return;
  chrome.tabs.create({ url: NEWEST_BASE + url });
});

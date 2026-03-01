const toggle = document.getElementById('auto-scan');

chrome.storage.sync.get({ autoScan: false }, (data) => {
  toggle.checked = data.autoScan;
});

toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: toggle.checked });
});

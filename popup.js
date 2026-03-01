const autoScanToggle = document.getElementById('auto-scan');
const showProgressToggle = document.getElementById('show-progress');

chrome.storage.sync.get({ autoScan: false, showProgress: false }, (data) => {
  autoScanToggle.checked = data.autoScan;
  showProgressToggle.checked = data.showProgress;
});

autoScanToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: autoScanToggle.checked });
});

showProgressToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ showProgress: showProgressToggle.checked });
});

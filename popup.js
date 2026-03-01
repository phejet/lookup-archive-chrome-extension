const autoScanToggle = document.getElementById('auto-scan');
const showProgressToggle = document.getElementById('show-progress');

chrome.storage.sync.get({ autoScan: false, showOnDemandProgress: false }, (data) => {
  autoScanToggle.checked = data.autoScan;
  showProgressToggle.checked = data.showOnDemandProgress;
});

autoScanToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: autoScanToggle.checked });
});

showProgressToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ showOnDemandProgress: showProgressToggle.checked });
});

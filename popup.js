const autoScanToggle = document.getElementById('auto-scan');
const showProgressToggle = document.getElementById('show-progress');
const debugLoggingToggle = document.getElementById('debug-logging');

chrome.storage.sync.get({ autoScan: false, showOnDemandProgress: false, debugLogging: false }, (data) => {
  autoScanToggle.checked = data.autoScan;
  showProgressToggle.checked = data.showOnDemandProgress;
  debugLoggingToggle.checked = data.debugLogging;
});

autoScanToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ autoScan: autoScanToggle.checked });
});

showProgressToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ showOnDemandProgress: showProgressToggle.checked });
});

debugLoggingToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ debugLogging: debugLoggingToggle.checked });
});

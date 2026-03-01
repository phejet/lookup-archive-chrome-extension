const listEl = document.getElementById('prefix-list');
const inputEl = document.getElementById('prefix-input');
const addBtn = document.getElementById('add-btn');

addBtn.addEventListener('click', addPrefix);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPrefix();
});

function addPrefix() {
  const value = inputEl.value.trim();
  if (!value) return;
  chrome.storage.sync.get({ prefixes: [] }, (data) => {
    const prefixes = data.prefixes;
    if (prefixes.includes(value)) {
      inputEl.value = '';
      return;
    }
    prefixes.push(value);
    chrome.storage.sync.set({ prefixes }, () => {
      inputEl.value = '';
      renderList(prefixes);
    });
  });
}

function removePrefix(prefix) {
  chrome.storage.sync.get({ prefixes: [] }, (data) => {
    const prefixes = data.prefixes.filter(p => p !== prefix);
    chrome.storage.sync.set({ prefixes }, () => {
      renderList(prefixes);
    });
  });
}

function renderList(prefixes) {
  listEl.innerHTML = '';
  if (prefixes.length === 0) {
    listEl.innerHTML = '<li class="empty">No prefixes configured.</li>';
    return;
  }
  for (const prefix of prefixes) {
    const li = document.createElement('li');
    li.className = 'prefix-item';
    li.innerHTML = `<span>${escapeHtml(prefix)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'remove-btn';
    btn.textContent = '\u00d7';
    btn.title = 'Remove';
    btn.addEventListener('click', () => removePrefix(prefix));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Load on open
chrome.storage.sync.get({ prefixes: [] }, (data) => {
  renderList(data.prefixes);
});

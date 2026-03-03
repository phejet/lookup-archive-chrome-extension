// Global test setup — mocks Chrome APIs, fetch, and missing jsdom APIs

// --- Chrome API stubs ---
const chromeMock = {
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onMessage: { addListener: vi.fn() },
    sendMessage: vi.fn(),
    lastError: null,
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    sync: {
      get: vi.fn((defaults, cb) => {
        if (typeof cb === 'function') cb(defaults);
        return Promise.resolve(defaults);
      }),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: vi.fn() },
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(),
    sendMessage: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue(undefined),
    insertCSS: vi.fn().mockResolvedValue(undefined),
    registerContentScripts: vi.fn().mockResolvedValue(undefined),
    unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
  },
  permissions: {
    request: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
  },
};
vi.stubGlobal('chrome', chromeMock);

// --- Fetch stub ---
vi.stubGlobal('fetch', vi.fn());

// --- AbortSignal.timeout (not available in jsdom) ---
if (!AbortSignal.timeout) {
  AbortSignal.timeout = vi.fn(() => new AbortController().signal);
}

// --- CSS.escape polyfill (not available in jsdom) ---
const cssEscapePolyfill = (s) => s.replace(/([^\w-])/g, (ch) => '\\' + ch);
if (typeof CSS === 'undefined') {
  vi.stubGlobal('CSS', { escape: cssEscapePolyfill });
} else if (!CSS.escape) {
  CSS.escape = cssEscapePolyfill;
}

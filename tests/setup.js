// Global test setup — mocks Chrome APIs

const chromeMock = {
  runtime: {
    onInstalled: { addListener: vi.fn() },
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(),
  },
};
vi.stubGlobal('chrome', chromeMock);

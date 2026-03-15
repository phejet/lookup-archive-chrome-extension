import { test, expect, chromium } from '@playwright/test';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

test.describe.configure({ mode: 'serial' });

const EXTENSION_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'styles.css',
  'rules.json',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

async function prepareExtensionDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'archive-lookup-extension-'));
  for (const rel of EXTENSION_FILES) {
    const src = path.resolve(process.cwd(), rel);
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest);
  }

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const hostPermissions = new Set(manifest.host_permissions || []);
  hostPermissions.add('http://localhost/*');
  hostPermissions.add('http://127.0.0.1/*');
  manifest.host_permissions = [...hostPermissions];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

function startFixtureServer(html) {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end('bad request');
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.url.endsWith('.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Article</title>');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://localhost:${port}`,
      });
    });
  });
}

async function runRealExtensionFixtureScenario({
  fixtureRelPath,
  archivedPath,
  missingPath,
  snapshotTimestamp,
}) {
  const fixturePath = path.resolve(process.cwd(), fixtureRelPath);
  const fixtureHtml = await readFile(fixturePath, 'utf8');
  const { server, baseUrl } = await startFixtureServer(fixtureHtml);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'archive-lookup-e2e-'));
  const extensionPath = await prepareExtensionDir();
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });

    await context.route('https://archive.is/timemap/**', async (route) => {
      const requested = route.request().url();
      if (requested.includes(archivedPath)) {
        const timemap = [
          `<${baseUrl}${archivedPath}>; rel="original",`,
          `<https://archive.md/${snapshotTimestamp}/${baseUrl}${archivedPath}>; rel="first last memento"; datetime="Sat, 07 Mar 2026 12:00:00 GMT"`,
        ].join('\n');
        await route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: timemap,
        });
        return;
      }
      if (requested.includes(missingPath)) {
        await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
    });

    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));

    await serviceWorker.evaluate(() =>
      chrome.storage.sync.set({
        autoScan: true,
        autoScanSites: ['localhost'],
        showOnDemandProgress: true,
        debugLogging: false,
      }),
    );

    const page = await context.newPage();
    await page.goto(baseUrl + '/');

    await expect(page.locator('#archived-link .archive-today-indicator')).toHaveCount(1, {
      timeout: 10000,
    });
    await expect(page.locator('#missing-link .archive-today-indicator')).toHaveCount(0);
  } finally {
    server.close();
    if (context) await context.close();
    await rm(extensionPath, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
}

test('real extension autoscan works against saved local fixture with mocked timemap', async () => {
  await runRealExtensionFixtureScenario({
    fixtureRelPath: 'e2e/fixtures/news-localhost.html',
    archivedPath: '/2026/03/07/world/europe/sample-story.html',
    missingPath: '/2026/03/07/us/sample-local-story.html',
    snapshotTimestamp: '20260307120000',
  });
});

test('real extension autoscan works against AFR snapshot fixture with mocked timemap', async () => {
  await runRealExtensionFixtureScenario({
    fixtureRelPath: 'e2e/fixtures/afr-snapshot.html',
    archivedPath:
      '/companies/mining/bhp-s-copper-pivot-the-end-of-the-iron-ore-era-20260303-p5o6yd.html',
    missingPath: '/companies/mining/non-existent-afr-story-20990101-p0test.html',
    snapshotTimestamp: '20260308103000',
  });
});

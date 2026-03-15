import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FIXTURE_URL = 'https://fixture.test/';
const ARCHIVED_URL = 'https://fixture.test/2026/03/07/world/europe/sample-story.html';
const SNAPSHOT_URL =
  'https://archive.md/20260307120000/https://fixture.test/2026/03/07/world/europe/sample-story.html';

async function loadFixturePage(page) {
  const fixturePath = path.resolve(process.cwd(), 'e2e/fixtures/news-snapshot.html');
  const html = await readFile(fixturePath, 'utf8');

  await page.route('**/*', async (route) => {
    if (route.request().url() === FIXTURE_URL) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: html,
      });
      return;
    }
    await route.abort();
  });

  await page.addInitScript(
    ({ archivedUrl, snapshotUrl }) => {
      const listeners = [];
      window.__scanCallCount = 0;

      window.chrome = {
        runtime: {
          lastError: null,
          onMessage: {
            addListener: (fn) => listeners.push(fn),
          },
          sendMessage: (msg, cb) => {
            if (msg.action === 'check-batch-cache-only') {
              setTimeout(() => cb({}), 0);
              return;
            }
            if (msg.action === 'check-single') {
              window.__scanCallCount += 1;
              setTimeout(() => cb(msg.url === archivedUrl ? snapshotUrl : null), 450);
              return;
            }
            setTimeout(() => cb(null), 0);
          },
        },
        storage: {
          sync: {
            get: async (defaults) => ({
              ...defaults,
              autoScan: false,
              autoScanSites: [],
              showOnDemandProgress: true,
              debugLogging: false,
            }),
          },
          onChanged: {
            addListener: () => {},
          },
        },
      };

      window.__triggerManualScan = () => {
        for (const listener of listeners) {
          listener({ action: 'scan-page' }, null, () => {});
        }
      };
    },
    { archivedUrl: ARCHIVED_URL, snapshotUrl: SNAPSHOT_URL },
  );

  await page.goto(FIXTURE_URL);
  await page.addStyleTag({ path: path.resolve(process.cwd(), 'styles.css') });
  await page.addScriptTag({ path: path.resolve(process.cwd(), 'content.js') });
}

test('manual scan banner remains visible when scan is retriggered mid-flight', async ({ page }) => {
  await loadFixturePage(page);

  await page.evaluate(() => window.__triggerManualScan());
  await page.waitForTimeout(60);
  await page.evaluate(() => window.__triggerManualScan());

  const banner = page.locator('#archive-today-status');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Scanning for archived articles...');
  await expect(banner).toContainText('Scan done:', { timeout: 4000 });

  await expect(page.locator('#archived-link .archive-today-indicator')).toHaveCount(1);
});

test('manual rescan re-injects icon after article link is re-rendered', async ({ page }) => {
  await loadFixturePage(page);

  await page.evaluate(() => window.__triggerManualScan());
  await expect(page.locator('#archived-link .archive-today-indicator')).toHaveCount(1, {
    timeout: 4000,
  });

  await page.evaluate(() => {
    const li = document.querySelector('li');
    li.innerHTML = `
      <a id="archived-link-new" href="https://fixture.test/2026/03/07/world/europe/sample-story.html">
        Archived article candidate (re-rendered)
      </a>
    `;
  });

  await expect(page.locator('#archived-link-new .archive-today-indicator')).toHaveCount(0);
  await page.evaluate(() => window.__triggerManualScan());
  await expect(page.locator('#archived-link-new .archive-today-indicator')).toHaveCount(1, {
    timeout: 4000,
  });
});

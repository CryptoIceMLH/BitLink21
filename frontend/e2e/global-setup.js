import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const setupDir = path.dirname(fileURLToPath(import.meta.url));
const storageStatePath = path.resolve(setupDir, '.auth/state.json');

async function ensureLocationIfMissing(page, baseURL) {
  await page.goto(`${baseURL}/`);
  await page.waitForLoadState('domcontentloaded');

  await page.goto(`${baseURL}/settings/location`);
  await page.waitForLoadState('domcontentloaded');

  const map = page.locator('.leaflet-container');
  await map.waitFor({ state: 'visible' });

  const marker = page.locator('.leaflet-marker-icon');
  const hasMarker = (await marker.count()) > 0;

  if (!hasMarker) {
    await page.screenshot({ path: path.resolve(setupDir, '.auth/location-before.png'), fullPage: true });
    console.log('Saved location-before screenshot.');

    const box = await map.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await map.click();
    }
    await page.waitForTimeout(500);

    const saveButton = page.getByRole('button', { name: /save location/i });
    await saveButton.waitFor({ state: 'visible' });
    await saveButton.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.resolve(setupDir, '.auth/location-after.png'), fullPage: true });
    console.log('Saved location-after screenshot.');
  }
}

export default async function globalSetup(config) {
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await ensureLocationIfMissing(page, baseURL);

  await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });
  await page.context().storageState({ path: storageStatePath });
  await browser.close();
}

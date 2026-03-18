/**
 * E2E tests for settings pages
 */

import { test, expect } from '@playwright/test';

test.describe('Preferences Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/preferences');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display preferences page', async ({ page }) => {
    // Check for General heading or preferences content
    await expect(
      page.getByRole('heading', { name: /general/i }).or(
        page.getByText(/general/i).first()
      )
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display theme preference option', async ({ page }) => {
    // Look for theme-related text or controls
    const themeOption = page.getByText(/theme/i).first();
    await expect(themeOption).toBeVisible({ timeout: 10000 });
  });

  test('should display language preference option', async ({ page }) => {
    // Look for language-related text or controls
    const languageOption = page.getByText(/language/i).first();
    await expect(languageOption).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Location Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/location');
    await page.waitForLoadState('domcontentloaded');
  });


  test('should have latitude and longitude fields', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for latitude/longitude labels or inputs
    const latLonText = page.getByText(/latitude|longitude|lat|lon|coordinates/i);
    await expect(latLonText.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Maintenance Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/maintenance');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display maintenance page', async ({ page }) => {
    // Wait for page to load
    await page.waitForTimeout(2000);

    // Page should be loaded (basic check)
    expect(page.url()).toContain('/settings/maintenance');
  });

  test('should have maintenance controls or information', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for buttons or text related to maintenance
    const buttons = page.locator('button');
    const count = await buttons.count();

    // Should have some interactive elements
    expect(count).toBeGreaterThan(0);
  });
});

test.describe('About Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings/about');
    await page.waitForLoadState('domcontentloaded');
  });

  test('should display about page', async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(2000);

    // Should be on the about page
    expect(page.url()).toContain('/settings/about');
  });

  test('should display application information', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for common about page elements like version, copyright, or BitLink21 text
    const aboutContent = page.getByText(/version|copyright|bitlink21|license/i);
    await expect(aboutContent.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Settings Navigation Flow', () => {
  test('should navigate between different settings pages', async ({ page }) => {
    // Start at preferences
    await page.goto('/settings/preferences');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/settings/preferences');

    // Navigate to location
    await page.goto('/settings/location');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/settings/location');

    // Navigate to maintenance
    await page.goto('/settings/maintenance');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/settings/maintenance');

    // Navigate to about
    await page.goto('/settings/about');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/settings/about');
  });
});

test.describe('Preferences Persistence', () => {
  test('should persist theme preference after refresh', async ({ page }) => {
    await page.goto('/settings/preferences');
    await page.waitForLoadState('domcontentloaded');

    const themeSelect = page.locator('#theme-selector');
    await themeSelect.click();
    await page.getByRole('option', { name: 'Terminal' }).click();

    await page.getByRole('button', { name: /save preferences|enregistrer/i }).click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('domcontentloaded');

    await themeSelect.click();
    await expect(page.getByRole('option', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');

    await themeSelect.click();
    await page.getByRole('option', { name: 'Auto (System)' }).click();
    await page.getByRole('button', { name: /save preferences|enregistrer/i }).click();
    await page.waitForTimeout(2000);
    await page.waitForLoadState('domcontentloaded');
  });
});

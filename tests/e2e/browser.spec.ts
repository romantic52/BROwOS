import { expect, test } from '@playwright/test';
import { boot, closeWelcome, launchApp } from './helpers';

test('BROwser navigates fixture pages, keeps tab history and persists bookmarks', async ({
  page,
}) => {
  await page.route(/^https:\/\/(one|two)\.browos\.test\//, async (route) => {
    const url = new URL(route.request().url());
    const heading = url.pathname === '/second' ? 'Fixture second page' : 'Fixture first page';
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>${heading}</title></head><body><h1>${heading}</h1><p>This document is a controlled E2E fixture.</p></body></html>`,
    });
  });
  await boot(page);
  await closeWelcome(page);
  let browser = await launchApp(page, 'browser');
  const address = browser.getByRole('textbox', { name: 'Адрес сайта' });
  await address.fill('https://one.browos.test/first');
  await address.press('Enter');
  await expect(
    browser.frameLocator('iframe').getByRole('heading', { name: 'Fixture first page' }),
  ).toBeVisible();
  await address.fill('https://one.browos.test/second');
  await address.press('Enter');
  await expect(
    browser.frameLocator('iframe').getByRole('heading', { name: 'Fixture second page' }),
  ).toBeVisible();
  await browser.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(
    browser.frameLocator('iframe').getByRole('heading', { name: 'Fixture first page' }),
  ).toBeVisible();
  await browser.getByRole('button', { name: 'Вперёд', exact: true }).click();
  await expect(
    browser.frameLocator('iframe').getByRole('heading', { name: 'Fixture second page' }),
  ).toBeVisible();
  await browser.getByRole('button', { name: 'Добавить в закладки' }).click();
  await expect(
    browser
      .locator('.browser-bookmarks')
      .getByRole('button', { name: 'one.browos.test', exact: true }),
  ).toBeVisible();
  await browser.getByRole('button', { name: 'Новая вкладка', exact: true }).click();
  await expect(browser.getByRole('tab')).toHaveCount(2);
  await address.fill('https://two.browos.test/first');
  await address.press('Enter');
  await expect(
    browser.frameLocator('iframe').getByRole('heading', { name: 'Fixture first page' }),
  ).toBeVisible();
  await browser.getByRole('tab', { name: 'one.browos.test', exact: true }).click();
  await expect(address).toHaveValue('https://one.browos.test/second');
  await expect(
    browser.frameLocator('iframe').getByRole('heading', { name: 'Fixture second page' }),
  ).toBeVisible();
  await browser.getByRole('button', { name: 'Закрыть вкладку two.browos.test' }).click();
  await expect(browser.getByRole('tab')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Пуск', exact: true })).toBeVisible();
  browser = await launchApp(page, 'browser');
  await expect(
    browser
      .locator('.browser-bookmarks')
      .getByRole('button', { name: 'one.browos.test', exact: true }),
  ).toBeVisible();
});

test('BROwser rejects executable schemes and does not persist the connection token', async ({
  page,
}) => {
  await boot(page);
  await closeWelcome(page);
  const browser = await launchApp(page, 'browser');
  const address = browser.getByRole('textbox', { name: 'Адрес сайта' });
  await address.fill('javascript:alert(1)');
  await address.press('Enter');
  await expect(browser.getByRole('alert')).toContainText('HTTP и HTTPS');
  await expect(browser.locator('iframe')).toHaveCount(0);
  await browser.getByRole('button', { name: 'Подключить', exact: true }).click();
  const connection = browser.getByRole('dialog', { name: 'Подключение Chromium' });
  const token = 'browos-e2e-test-only-not-a-real-credential';
  await connection.getByLabel('Токен доступа Chromium').fill(token);
  await connection.getByRole('button', { name: 'Закрыть подключение' }).click();
  expect(
    await page.evaluate(
      (value) => Object.values(localStorage).some((entry) => entry.includes(value)),
      token,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(
      (value) => Object.values(sessionStorage).some((entry) => entry.includes(value)),
      token,
    ),
  ).toBe(false);
});

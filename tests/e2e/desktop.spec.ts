import { expect, test } from '@playwright/test';
import { boot, closeWelcome, launchApp } from './helpers';

test('boots a working desktop and opens the Start menu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await expect(page.getByTestId('window-welcome')).toContainText('Чувствуйте себя дома.');
  await page.getByRole('button', { name: 'Пуск', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Меню Пуск' })).toBeVisible();
  await expect(page.locator('.start-list')).toContainText('Проводник');
  await expect(page.locator('.start-list')).toContainText('Терминал');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Меню Пуск' })).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('moves, resizes, minimizes, maximizes and snaps an actual window', async ({ page }) => {
  await boot(page);
  await closeWelcome(page);
  const notepad = await launchApp(page, 'notepad');
  const original = (await notepad.boundingBox())!;
  const title = (await notepad.locator('.window-titlebar').boundingBox())!;
  await page.mouse.move(title.x + 120, title.y + 15);
  await page.mouse.down();
  await page.mouse.move(title.x + 210, title.y + 75, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await notepad.boundingBox())!.x).toBeGreaterThan(original.x + 50);
  const beforeResize = (await notepad.boundingBox())!;
  const handle = (await notepad.locator('.resize-se').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 85, handle.y + 55, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(async () => (await notepad.boundingBox())!.width)
    .toBeGreaterThan(beforeResize.width + 40);
  await notepad.getByRole('button', { name: 'Развернуть', exact: true }).click();
  await expect(notepad).toHaveClass(/maximized/);
  await expect.poll(async () => (await notepad.boundingBox())!.width).toBeGreaterThan(1400);
  await notepad.getByRole('button', { name: 'Восстановить', exact: true }).click();
  await expect(notepad).not.toHaveClass(/maximized/);
  await notepad.getByRole('button', { name: 'Свернуть', exact: true }).click();
  await expect(notepad).not.toBeVisible();
  await page.getByRole('button', { name: 'Блокнот на панели задач' }).click();
  await expect(notepad).toBeVisible();
  await notepad.getByRole('button', { name: 'Прикрепить окно' }).click();
  await notepad.getByRole('button', { name: '← Левая половина' }).click();
  await expect.poll(async () => Math.round((await notepad.boundingBox())!.width)).toBe(720);
  await expect.poll(async () => Math.round((await notepad.boundingBox())!.x)).toBe(0);
});

test('keeps application windows on their selected virtual desktop', async ({ page }) => {
  await boot(page);
  await closeWelcome(page);
  const calculator = await launchApp(page, 'calculator');
  await page.getByRole('button', { name: 'Представление задач', exact: true }).click();
  await page
    .locator('.desktop-switcher')
    .getByRole('button', { name: /Рабочий стол 2/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(calculator).not.toBeVisible();
  const notepad = await launchApp(page, 'notepad');
  await page.getByRole('button', { name: 'Представление задач', exact: true }).click();
  await page
    .locator('.desktop-switcher')
    .getByRole('button', { name: /Рабочий стол 1/ })
    .click();
  await page.keyboard.press('Escape');
  await expect(calculator).toBeVisible();
  await expect(notepad).not.toBeVisible();
});

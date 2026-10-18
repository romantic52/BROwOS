import { expect, test } from '@playwright/test';
import { boot, closeWelcome, launchApp, saveDialog } from './helpers';

test('captures the real desktop and a working application workspace', async ({
  page,
}, testInfo) => {
  await boot(page);
  await expect(page.getByTestId('window-welcome')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), animations: 'disabled' });
  await testInfo.attach('BROwOS desktop', {
    path: testInfo.outputPath('desktop.png'),
    contentType: 'image/png',
  });
  await closeWelcome(page);
  const notepad = await launchApp(page, 'notepad');
  await notepad
    .getByRole('textbox', { name: 'Текст документа' })
    .fill(
      'Моё рабочее пространство BROwOS\n\nЗдесь можно писать, рисовать и организовывать файлы.\nЭтот текст сохранён в общей файловой системе.',
    );
  await notepad.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await saveDialog(page, 'Мои идеи.txt');
  await notepad.getByRole('button', { name: 'Прикрепить окно' }).click();
  await notepad.getByRole('button', { name: '← Левая половина' }).click();
  const explorer = await launchApp(page, 'explorer');
  await explorer
    .locator('.explorer-sidebar')
    .getByRole('button', { name: 'Документы', exact: true })
    .click();
  await explorer.getByRole('button', { name: 'Прикрепить окно' }).click();
  await explorer.getByRole('button', { name: 'Правая половина →' }).click();
  await expect(explorer.getByTestId('file-item').filter({ hasText: 'Мои идеи.txt' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), animations: 'disabled' });
  await testInfo.attach('BROwOS saved document and Explorer', {
    path: testInfo.outputPath('workspace.png'),
    contentType: 'image/png',
  });
});

# BROwOS Application SDK

SDK описывает контракт встроенных приложений BROwOS. Приложение — доверенный
React-компонент, включённый в исходный код и общую сборку. Он получает идентификатор
окна и сервисы рабочего стола: виртуальные файлы, диалоги, уведомления и запуск
других приложений.

В preview нет установки произвольных внешних пакетов, отдельного процесса,
permission broker или sandbox для стороннего React-кода. Компонент работает в
том же JavaScript origin, что и оболочка. При добавлении приложения его исходники
должны проходить обычный review проекта.

Источники контрактов: [packages/sdk](../packages/sdk/src/index.ts),
[application-runtime](../packages/application-runtime/src/index.ts),
[интеграция оболочки](../apps/web/src/App.tsx).

## Контракт приложения

```ts
interface AppProps {
  services: DesktopServices;
  windowId: string;
  data?: Record<string, unknown>;
}

interface AppManifest {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  defaultSize: { width: number; height: number };
  singleton?: boolean;
  extensions?: string[];
}
```

`windowId` уникален для экземпляра окна. При нескольких окнах одного приложения
их локальное React-состояние независимо. `singleton: true` переиспользует уже
открытое окно, переводит фокус и переключает рабочий стол при необходимости.
Размер из manifest ограничивается доступной рабочей областью оболочки.

`data` содержит параметры запуска, а не доверенную внешнюю конфигурацию. Проверяйте
типы значений. Встроенные файловые приложения используют `fileId` и `folderId`.
Они должны корректно обрабатывать удалённый, перемещённый или недоступный файл.

Оболочка сохраняет состояние окон в localStorage. При восстановлении проходит
только валидированный набор параметров `fileId`/`folderId`; произвольный `data`
не является устойчивым хранилищем. Не передавайте туда токены, секреты или
несохранённые документы.

## Сервисы рабочего стола

| Сервис                                                     | Поведение                                                                                      |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `fs`                                                       | Общий `VirtualFileSystem`; один экземпляр на оболочку                                          |
| `revision`                                                 | Текущая версия кэша VFS; используйте как зависимость для пересчёта списков                     |
| `openApp(appId, data?)`                                    | Открывает приложение из доверенного registry                                                   |
| `openFile(id)`                                             | Папку открывает в Explorer; файл передаёт приложению по MIME/расширению                        |
| `notify(message, kind?)`                                   | Уведомление `info`, `success` или `error`                                                      |
| `setTitle(windowId, title)`                                | Обновляет заголовок указанного окна                                                            |
| `setCloseGuard(windowId, guard)`                           | Синхронная проверка закрытия; `false` отменяет закрытие, `null` снимает guard                  |
| `pickFile({accept?, title?}?)`                             | Общий Open dialog; возвращает ID файла или `null` при отмене                                   |
| `saveFile({name, content, mime?, parentId?, existingId?})` | Сохраняет Blob/строку; без `existingId` использует общий Save dialog; возвращает ID или `null` |

Общий диалог обслуживает один запрос за раз. Если уже открыт другой диалог,
новый запрос завершается с `null` и уведомлением; приложение должно сохранять
свой черновик и позволять повторить действие. Отмена — штатный результат.

`accept` файлового диалога поддерживает расширения и MIME-типы, в том числе
семейства вроде `image/*`. Это фильтр выбора; приложение всё равно проверяет
выбранные данные и обрабатывает ошибки чтения.

### Версии при сохранении существующего файла

Текущий `services.saveFile({existingId, ...})` записывает файл без автоматической
проверки прочитанной версии. Для редактора, который должен обнаруживать изменения
другим окном, используйте `fs.updateFile(id, content, mime, expectedUpdatedAt)`
и храните версию открытого документа. Так работают собственные модели редакторов
BROwOS. При `FSError` с кодом `CONFLICT` сохраните черновик и предложите явное
действие пользователя: перечитать файл, сохранить копию либо согласовать замену.

Не перечитывайте новую версию непосредственно перед записью только для прохождения
проверки: это скрывает конфликт и может уничтожить чужие изменения.

## Минимальное встроенное приложение

Ниже пример нового доверенного приложения `scratchpad`. Это инструкция для
разработки, а не заявление, что этот дополнительный компонент уже установлен.
Он сохраняет новый документ через общий диалог и защищает несохранённый текст
при закрытии окна.

Создайте `system-apps/scratchpad/package.json`:

```json
{
  "name": "@browos/scratchpad",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.tsx",
  "dependencies": {
    "@browos/sdk": "workspace:*",
    "react": "^19.0.0"
  }
}
```

Добавьте `system-apps/scratchpad/src/index.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { AppProps } from '@browos/sdk';

export default function ScratchpadApp({ services, windowId }: AppProps) {
  const [text, setText] = useState('');
  const [savedText, setSavedText] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = text !== savedText;
  const { saveFile, setCloseGuard, setTitle, notify } = services;

  useEffect(() => {
    setTitle(windowId, `${dirty ? '• ' : ''}Черновик — BROwOS`);
    setCloseGuard(
      windowId,
      dirty ? () => window.confirm('Закрыть без сохранения изменений?') : null,
    );
    return () => setCloseGuard(windowId, null);
  }, [dirty, setCloseGuard, setTitle, windowId]);

  async function saveCopy() {
    if (saving) return;
    const snapshot = text;
    setSaving(true);
    try {
      const id = await saveFile({
        name: 'Черновик.txt',
        content: snapshot,
        mime: 'text/plain',
      });
      if (id) {
        setSavedText(snapshot);
        notify('Документ сохранён', 'success');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Черновик">
      <button type="button" disabled={saving} onClick={() => void saveCopy()}>
        {saving ? 'Сохранение…' : 'Сохранить как…'}
      </button>
      <textarea
        aria-label="Текст документа"
        value={text}
        onChange={(event) => setText(event.target.value)}
        style={{ width: '100%', minHeight: 260, resize: 'vertical' }}
      />
    </section>
  );
}
```

Снимок `snapshot` фиксирует именно сохраняемую версию: если пользователь
изменит текст, пока открыт диалог, новый текст останется dirty после сохранения.
Пример всегда проходит через Save dialog. Совпавшее имя требует отдельного
подтверждения замены в диалоге; для редактора открытого файла добавьте описанную
выше проверку версии.

### Регистрация

Добавьте manifest в массив `applications` в
`packages/application-runtime/src/index.ts`:

```ts
{
  id: 'scratchpad',
  title: 'Черновик',
  description: 'Быстрый текстовый документ',
  icon: 'notepad',
  color: '#0078d4',
  defaultSize: { width: 640, height: 480 },
}
```

Затем подключите компонент в `apps/web/src/App.tsx` и добавьте его в `components`:

```tsx
import ScratchpadApp from '../../../system-apps/scratchpad/src';

// Дополнение к существующему components, не замена других приложений:
// scratchpad: ScratchpadApp,
```

Manifest включает приложение в launcher/поиск; запись `components` предоставляет
исполняемый компонент. Используйте существующий `icon` из
`packages/ui/src/index.tsx` либо добавьте согласованный символ в UI-пакет.
Для расширений файлов добавьте `extensions` в manifest с учётом порядка registry:
MIME изображений и медиа обрабатывается раньше поиска по расширению, а неизвестный
текстовый формат по умолчанию открывается Блокнотом.

После добавления workspace-пакета выполните `pnpm install` и включите изменённый
lockfile в PR. Проверьте `pnpm typecheck`, `pnpm lint` и `pnpm build:web`, затем
пройдите пользовательский сценарий: открыть два окна, сохранить текст,
прочитать его через Explorer и отменить закрытие dirty-документа. Для содержательной
новой логики добавьте поведенческий тест в `tests/apps` или E2E.

## Работа с общей файловой системой

Полная спецификация и примеры доступны в
[packages/filesystem/README.md](../packages/filesystem/README.md).

| Задача                                    | API                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Получить метаданные из кэша               | `fs.get(id)`, `fs.list(parentId)`, `fs.search(query)`                      |
| Найти путь и разрешить его                | `fs.path(id)`, `fs.resolve(path)`; путь разрешается от корня VFS           |
| Прочитать содержимое                      | `await fs.readFile(id)` → Blob; `await fs.readText(id)` → строка           |
| Создать папку / новый файл                | `fs.mkdir(parentId, name)`, `fs.writeFile(parentId, name, content, mime?)` |
| Изменить файл                             | `fs.updateFile(id, content, mime?, expectedUpdatedAt?)`                    |
| Переименовать / переместить / скопировать | `fs.rename`, `fs.move`, `fs.copy`                                          |
| Корзина / восстановление                  | `fs.trash(id)`, `fs.restore(id)`, `fs.listTrash()`                         |
| Постоянное удаление                       | `fs.deletePermanent(id)`; подтверждение организует вызывающий UI           |
| Backup / импорт                           | `fs.exportBackup()`, `fs.importBackup(serialized)`                         |
| Обновить кэш / подписаться                | `await fs.refresh()`, `fs.subscribe(listener)`                             |

Мутации асинхронны. Дожидайтесь завершения транзакции перед сообщением об успехе.
Не обновляйте собственный UI так, будто операция уже сохранена, если Promise
вернулся с ошибкой. `fs.revision` и `services.revision` изменяются после commit;
подписки уведомляют заинтересованные компоненты.

`writeFile` создаёт новый файл и не предназначен для скрытой перезаписи.
Проверяйте ожидаемые `FSError.code`: конфликт имени, удалённый файл, запрещённая
операция, конфликт версии, недостаток quota или недоступное хранилище. Показывайте
понятное действие пользователю и сохраняйте редактируемый черновик при ошибке.

Приложение не должно закрывать общий `services.fs`: его жизненным циклом управляет
оболочка. Если компонент сам подписался на `fs.subscribe`, вызовите возвращённую
функцию отписки в cleanup.

## Жизненный цикл и ресурсы

- Убирайте `setCloseGuard` при unmount. Guard синхронный; асинхронное сохранение
  организуется кнопкой или отдельным диалогом до закрытия.
- Отменяйте собственные fetch, timers и polling при закрытии окна или смене
  документа. Игнорируйте ответы устаревшего запроса, чтобы они не заменили новый.
- Освобождайте `URL.createObjectURL` через `URL.revokeObjectURL`, когда Blob
  заменён или компонент закрыт. Это относится к изображениям, медиа и кадрам.
- Ограничивайте память для истории canvas, текста, логов и фоновых очередей.
  Встроенное приложение разделяет память вкладки с рабочим столом.
- Не используйте `eval`, shell-команды или доверие к импортированному HTML.
  Сохранённый файл является данными; его открытие не предоставляет привилегий.
- Сохранение расположения окна не сохраняет React-состояние редактора.
  Если нужны устойчивые черновики, разработайте отдельную модель хранения,
  восстановления и удаления; в текущем SDK её нет.

## Границы будущего внешнего SDK

Текущие TypeScript-интерфейсы упрощают встроенную разработку, но не ограничивают
возможности кода в одном origin. Для внешних приложений потребуется отдельная
изоляция, ограниченный messaging-протокол, явно выданные права на файлы и сеть,
проверка пакетов и отзыв доступа. До реализации этих механизмов не принимайте
пакет из недоверенного источника как безопасное расширение BROwOS.

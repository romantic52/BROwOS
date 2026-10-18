# Проверка BROwOS

Этот документ описывает воспроизводимые проверки, а результаты конкретного рабочего сеанса фиксируются в [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). Наличие теста или workflow в репозитории само по себе не означает успешного прогона. Для принятого изменения проверяйте SHA коммита, журнал команды и соответствующий [запуск GitHub Actions](https://github.com/romantic52/BROwOS/actions).

## Среда

- Node.js 22.12+ или Node.js 24. CI проверяет обе ветви.
- pnpm **10.34.7**, соответствующий `packageManager` в корневом `package.json`.
- Для браузерных тестов — Chromium из версии Playwright, зафиксированной в lockfile.

В корне репозитория:

```bash
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile
```

Не удаляйте lockfile, чтобы скрыть несовместимость зависимостей. Установку новой версии пакета сопровождают изменённый lockfile, проверка поведения и результат CI.

## Команды

| Команда                   | Что проверяет                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`       | Форматирование исходников, конфигураций и документации                                                        |
| `pnpm lint`               | Правила ESLint и запрещённое динамическое исполнение кода                                                     |
| `pnpm typecheck`          | Общие TypeScript-контракты frontend, SDK, приложений и backend                                                |
| `pnpm test:unit`          | Парсеры, VFS, Window Manager, приложения, сетевую политику и API; Chromium-тесты имеют отдельный явный запуск |
| `pnpm test:integration`   | Взаимодействие подсистем и сохранение данных                                                                  |
| `pnpm build`              | Production frontend и TypeScript backend                                                                      |
| `pnpm audit:dependencies` | Уязвимости зависимостей уровня high и critical                                                                |
| `pnpm test:e2e`           | Пользовательские сценарии в Chromium на production frontend                                                   |

`pnpm check` объединяет форматирование, lint, typecheck, unit/integration и сборку. Аудит и E2E запускаются отдельно. Не заменяйте провалившийся тест флагом пропуска или удалением проверки: воспроизведите проблему, исправьте её и повторите нужный набор.

## Unit и integration

Тесты файловой системы используют `fake-indexeddb` и настоящую реализацию `VirtualFileSystem`. Они проверяют содержимое файлов, восстановление после открытия базы заново, конфликты имён и сохранений, корзину, резервные копии и связи между папками. Изолированные базы создаются для тестов; личное хранилище запущенного BROwOS не используется.

Примеры выборочного запуска:

```bash
pnpm exec vitest run tests/apps
pnpm exec vitest run tests/integration
pnpm exec vitest run tests/server
```

Обычный набор `tests/server` включает API и сетевые проверки, но реальные Chromium-сценарии запускаются только при `BROWOS_TEST_CHROMIUM=1`. Пропущенные сценарии нельзя считать проверенным серверным браузером.

## Реальный серверный Chromium

Установите Chromium и его системные зависимости:

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

Если официальный Playwright CDN недоступен на Linux x64, предусмотрен `docker/install-chromium.mjs`: сначала он обращается к Playwright, а затем использует официальный Chrome for Testing **той же версии**, указанной в установленном Playwright. Запускайте скрипт из `apps/server`, где объявлена зависимость `playwright`:

```bash
cd apps/server
node ../../docker/install-chromium.mjs
cd ../..
```

После установки:

```bash
BROWOS_TEST_CHROMIUM=1 pnpm exec vitest run tests/server
```

На ограниченном тестовом исполнителе, где Chromium sandbox не запускается, существует изолированный тестовый вариант:

```bash
BROWOS_TEST_CHROMIUM=1 BROWOS_TEST_DISABLE_SANDBOX=1 pnpm exec vitest run tests/server
```

Это проверяет browser runtime, API действий и сетевую политику, но не доказывает работу production sandbox на целевом хосте. Тестовые параметры отвергаются сервером вне `NODE_ENV=test`; production не имеет автоматического запуска без sandbox. Проверка Docker и sandbox на целевой машине остаётся отдельным условием Connected-развёртывания.

Сценарии используют управляемые HTTP-страницы: реальная навигация, JPEG-кадр, клик, ввод текста, клавиатура, прокрутка, размер viewport, история, изоляция cookies, лимит сессий, закрытие сессии и запрет редиректа к частному адресу. Эти страницы не требуют обращения к чужим личным кабинетам.

## Frontend E2E

Сначала соберите приложение. Playwright сам запускает **Vite preview**, а не dev-сервер:

```bash
pnpm build:web
pnpm test:e2e
```

Адрес проверки — `http://127.0.0.1:4173`, viewport — 1440 × 900, язык — русский, часовой пояс — UTC. В CI каждый прогон поднимает собственный preview. Локально уже запущенный сервер на 4173 можно переиспользовать; убедитесь, что он показывает текущую production-сборку.

Для заранее установленного совместимого браузера:

```bash
BROWOS_TEST_BROWSER_PATH=/absolute/path/to/chrome pnpm test:e2e
```

В PowerShell:

```powershell
$env:BROWOS_TEST_BROWSER_PATH = 'C:\path\to\chrome.exe'
pnpm test:e2e
Remove-Item Env:BROWOS_TEST_BROWSER_PATH
```

Используйте Chromium, соответствующий установленной версии Playwright. Произвольный системный браузер может отличаться по поддержке протокола и воспроизводимости.

### Пользовательские сценарии

| Область            | Наблюдаемый результат                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Загрузка           | Появляются рабочий стол, Welcome и меню Пуск; отсутствуют JavaScript page errors                                 |
| Окна               | Меняются координаты и размеры; работают сворачивание, восстановление, разворачивание и закрепление               |
| Рабочие столы      | Окна видны только на выбранном виртуальном рабочем столе                                                         |
| Проводник          | Создаются папка и файл, работают copy/rename/trash/restore, изменения переживают reload                          |
| Импорт и экспорт   | Скачанные байты совпадают с импортированным тестовым файлом                                                      |
| Блокнот            | Текст сохраняется, открывается через Проводник и переживает reload; отказ закрытия сохраняет несохранённый текст |
| Калькулятор        | Выполняется арифметика с приоритетом и отклоняется JavaScript-ввод                                               |
| Paint → Photos     | Реально изменяются пиксели, undo/redo восстанавливает холст, PNG сохраняется и декодируется просмотрщиком        |
| Медиаплеер         | Импортированный PCM WAV декодируется, воспроизводится и ставится на паузу                                        |
| Терминал           | Команды изменяют VFS; созданный текст открывается в Блокноте                                                     |
| BROwser            | Работают iframe-навигация, история, вкладки и постоянные закладки; запрещены исполняемые URL-схемы               |
| Данные подключения | Тестовый токен из формы не появляется в localStorage или sessionStorage                                          |

Iframe-сценарии подменяют только ответы заранее заданных тестовых адресов контролируемыми HTML-страницами. Они проверяют интерфейс Local-режима и настоящий рендеринг iframe; они не подтверждают, что любой внешний сайт разрешает встраивание.

### Отчёты и скриншоты

- `playwright-report/index.html` — браузерный отчёт.
- `test-results/e2e.xml` — машинный JUnit-отчёт.
- `test-results/` — screenshots при ошибках, трассы провалившихся сценариев и явные снимки из `screenshots.spec.ts`.
- `desktop.png` и `workspace.png` создаются тестом только после открытия настоящей оболочки и работы с документом.

Откройте отчёт:

```bash
pnpm exec playwright show-report
```

Для документации копируйте скриншоты из успешного прогона в `docs/screenshots/` и указывайте использованный commit. Не рисуйте результаты тестирования и не выдавайте макет за снимок работающего приложения.

## GitHub Actions и публикация

`CI` запускается при push и pull request. В матрице Node 22/24 выполняются форматирование, lint, typecheck, unit/integration, production build и аудит. Production frontend из Node 24 сохраняется как `web-dist-<SHA>`.

Затем CI вызывает отдельный reusable workflow `E2E`. Он скачивает **тот же build artifact**, устанавливает Chromium, выполняет реальные server integration и frontend E2E, сохраняет `browser-evidence-<SHA>`. Успех `CI` включает успех browser acceptance; зелёные unit tests при проваленном E2E не разрешают публикацию.

`Deploy Pages` принимает только успешный CI для push в `main` официального репозитория. Он проверяет, что SHA всё ещё соответствует `main`, скачивает прошедший E2E frontend и публикует его через Pages. Workflow не исполняет исходники проекта с правами публикации, не создаёт репозитории и не включает Pages административным API. Первоначальная настройка Pages как GitHub Actions выполняется владельцем или уже разрешённым внешним инструментом.

Демонстрационный адрес считается работающим только после завершившегося deployment и проверки HTTP/загрузки приложения. Workflow-файл сам по себе не доказывает наличие сайта.

## Официальные справочники

- [Playwright: web server](https://playwright.dev/docs/test-webserver)
- [Playwright: browsers and system dependencies](https://playwright.dev/docs/browsers)
- [GitHub Pages: custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions: artifact download](https://github.com/actions/download-artifact)

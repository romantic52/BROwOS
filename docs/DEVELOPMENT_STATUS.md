# BROwOS — Development Status

Версия исходного кода: **0.1.0 preview**. Этот файл фиксирует фактическую область
реализации и проверки; версия в `package.json` не означает опубликованный Release.

Официальный репозиторий: <https://github.com/romantic52/BROwOS>.

**Доставка:** PR [#7](https://github.com/romantic52/BROwOS/pull/7) **объединён**; основная ветка `main` содержит проверенную
реализацию **0.1.0 preview**, commit [afa791f](https://github.com/romantic52/BROwOS/commit/afa791f7b6ee335dcfed5363f7f46e090575525e). GitHub Release/tag не создавались.
[CI #39100264368](https://github.com/romantic52/BROwOS/actions/runs/39100264368) для PR завершился **success**; повторный [CI main #39100459559](https://github.com/romantic52/BROwOS/actions/runs/39100459559) после merge также завершился **success**.
Для `afa791f` сохранены artifacts сборки и браузерных проверок. GitHub Pages проверен HTTP-запросом: **404**.
[Deploy Pages #39100560196](https://github.com/romantic52/BROwOS/actions/runs/39100560196) завершился **failed** на `Read existing Pages configuration`
(`configure-pages`): `Get Pages site failed`, `HttpError: Not Found`.
CI кода успешен; Pages имеет отдельный статус **BLOCKED**.

Оформление About также **BLOCKED** доступными административными инструментами:
GitHub API подтвердил пустое описание и topics. Требуемые владельцем значения и
порядок настройки сохранены в [DEPLOYMENT.md](DEPLOYMENT.md#оформление-официального-репозитория).

## Как читать статус

| Статус      | Значение                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| NOT STARTED | Реализация ещё не начата.                                                                             |
| IN PROGRESS | Работа выполняется; критерии завершения ещё не подтверждены.                                          |
| IMPLEMENTED | Код реализован; соответствующая проверка ещё не выполнена или требует другой среды.                   |
| TESTED      | Указанная область проверена реально выполненным тестом. Не означает отсутствие всех возможных ошибок. |
| BLOCKED     | Для конкретного следующего действия отсутствует необходимая возможность или инфраструктура.           |

Статус подсистемы и доставка в GitHub учитываются отдельно. Локальный тест не
подтверждает push, merge, выполнение Actions или доступность публичной демонстрации.
Ссылки на PR и проверки добавляются только после появления реальных объектов GitHub.

## Подсистемы

| Подсистема                            | Статус      | Реализовано                                                                                                           | Ещё отсутствует / граница проверки                                                                                                   | Issue                                                                                                    | PR                                                | Подтверждение                                                                                                                                                   |
| ------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace и запускаемый frontend      | TESTED      | pnpm workspace, React/TypeScript/Vite, production build scripts, общий registry                                       | Доступность на других устройствах и публичная демонстрация                                                                           | [#5](https://github.com/romantic52/BROwOS/issues/5)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | Общий production build, ESLint и TypeScript прошли; 210 Vitest и 13 E2E passed                                                                                  |
| Загрузка, рабочий стол, Пуск, taskbar | TESTED      | Boot/lock UI, launcher и поиск, часы, область уведомлений, два рабочих стола                                          | Keyboard/screen reader QA, touch и другие браузеры                                                                                   | [#1](https://github.com/romantic52/BROwOS/issues/1)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | Пройдены сценарии tests/e2e/desktop.spec.ts в общем прогоне 13 E2E                                                                                              |
| Window Manager                        | TESTED      | Focus/z-order, move/resize, minimize/maximize/snap, restore bounds, show desktop, валидация восстановления            | Расширение доступности и проверка на других устройствах                                                                              | [#1](https://github.com/romantic52/BROwOS/issues/1)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | 23 модельных теста; E2E move/resize/minimize/maximize/snap и разделение рабочих столов                                                                          |
| Настройки ядра                        | TESTED      | Валидация и сохранение параметров, default/fallback, ограничение пользовательских значений                            | Синхронизация настроек между устройствами                                                                                            | [#1](https://github.com/romantic52/BROwOS/issues/1)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | 5 выполненных тестов `tests/kernel/settings.test.ts`                                                                                                            |
| Виртуальная файловая система          | TESTED      | IndexedDB, Blob, транзакционные операции, revision/cache, конкурентные записи, сохранение между открытиями            | Потоковые операции с крупными данными, облачная синхронизация                                                                        | [#2](https://github.com/romantic52/BROwOS/issues/2)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | 18 выполненных тестов `tests/filesystem/filesystem.test.ts`; проверки используют fake-indexeddb                                                                 |
| Корзина и резервные копии             | TESTED      | Восстановление, постоянное удаление, JSON backup, проверка и безопасное добавление импортируемых данных               | Зашифрованный и потоковый формат backup                                                                                              | [#2](https://github.com/romantic52/BROwOS/issues/2)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | Сценарии входят в те же 18 файловых тестов; это не дополнительный набор                                                                                         |
| Проводник и общие файловые диалоги    | TESTED      | Папки, поиск, сортировка, выделение, copy/cut/paste, import/export, Корзина, свойства, Open/Save                      | Операции drag-and-drop между папками и расширенные UI-сценарии                                                                       | [#2](https://github.com/romantic52/BROwOS/issues/2)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | E2E create/copy/rename/trash/restore/reload; import/download с побайтовой проверкой                                                                             |
| Runtime и SDK                         | IMPLEMENTED | Реестр доверенных React-компонентов, manifest, ассоциации файлов, типизированные сервисы                              | Установка внешних пакетов, permissions и изоляция стороннего кода                                                                    | [#3](https://github.com/romantic52/BROwOS/issues/3)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | `packages/application-runtime`, `packages/sdk`, [SDK.md](SDK.md)                                                                                                |
| Блокнот                               | TESTED      | Чтение/сохранение текста, поиск, dirty state, защита закрытия, конфликт версий                                        | Автосохранение и восстановление несохранённых черновиков                                                                             | [#3](https://github.com/romantic52/BROwOS/issues/3)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | Модельные тесты, файловая интеграция, E2E UTF-8 save/reopen и защита dirty-документа                                                                            |
| Калькулятор                           | TESTED      | Разбор арифметики без eval, приоритет операций, память/история в UI                                                   | Расширенные научные функции                                                                                                          | [#3](https://github.com/romantic52/BROwOS/issues/3)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | Модельные тесты; E2E арифметики и отказ исполняемого ввода                                                                                                      |
| Терминал                              | TESTED      | Команды над общей VFS, кавычки и пути, безопасная Корзина, запуск приложений                                          | Shell-процессы, системный доступ и выполнение произвольных программ не реализованы                                                   | [#3](https://github.com/romantic52/BROwOS/issues/3)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | 15 модельных тестов внутри набора приложений; E2E команды создают настоящий файл для Блокнота                                                                   |
| Paint                                 | TESTED      | Кисть/ластик/фигуры, цвета и толщина, ограниченная undo/redo история, PNG, версия при сохранении                      | Слои, восстановление черновиков и расширенная UI-приёмка инструментов                                                                | [#3](https://github.com/romantic52/BROwOS/issues/3)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | E2E изменение пикселей, undo/redo, сохранение PNG и открытие в Photos                                                                                           |
| Фотографии и медиаплеер               | TESTED      | Изображения из VFS, масштаб/поворот, playlist, playback/seek/volume для поддерживаемых браузером форматов             | Расширенные UI-сценарии; собственные кодеки, DRM и серверное аудио не реализованы                                                    | [#3](https://github.com/romantic52/BROwOS/issues/3)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | E2E открытие сохранённого PNG, декодирование/воспроизведение/пауза импортированного WAV                                                                         |
| Параметры и диспетчер задач           | IMPLEMENTED | Тема/акцент/обои/профиль, backup/import; список окон, focus и завершение приложений                                   | Host process/CPU monitoring, учётные записи и шифрование не реализованы                                                              | [#1](https://github.com/romantic52/BROwOS/issues/1), [#3](https://github.com/romantic52/BROwOS/issues/3) | [#7](https://github.com/romantic52/BROwOS/pull/7) | Модель настроек проверена; UI требует отдельной приёмки                                                                                                         |
| Общие утилиты                         | TESTED      | Работа с URL, форматами и безопасными значениями, используемыми приложениями                                          | Расширение по мере появления новых форматов                                                                                          | [#3](https://github.com/romantic52/BROwOS/issues/3), [#4](https://github.com/romantic52/BROwOS/issues/4) | [#7](https://github.com/romantic52/BROwOS/pull/7) | 23 выполненных теста `tests/shared/shared.test.ts`                                                                                                              |
| Интеграция файлов и приложений        | TESTED      | Общая VFS, сохранение и открытие документов, независимые экземпляры                                                   | Пользовательские сценарии браузерного UI                                                                                             | [#2](https://github.com/romantic52/BROwOS/issues/2), [#3](https://github.com/romantic52/BROwOS/issues/3) | [#7](https://github.com/romantic52/BROwOS/pull/7) | 4 выполненных теста `tests/integration/filesystem-apps.test.ts`                                                                                                 |
| BROwser Local                         | TESTED      | Вкладки, адресная строка, локальная история и закладки, sandboxed iframe и открытие внешнего сайта                    | Сайты вправе запрещать iframe; полноценный DOM-доступ к чужим origin отсутствует                                                     | [#4](https://github.com/romantic52/BROwOS/issues/4)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | E2E iframe-навигация, history/tabs/bookmarks, отказ исполняемых URL                                                                                             |
| BROwser Connected client              | TESTED      | Авторизованные команды, JPEG frame, клавиатура/мышь/resize, teardown и обработка ошибок                               | Acceptance через публичный backend и сквозная UI-проверка удалённого сайта                                                           | [#4](https://github.com/romantic52/BROwOS/issues/4)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | 29/29 transport/lifecycle tests; full TypeScript и scoped ESLint; E2E токен отсутствует в Web Storage                                                           |
| Chromium API и сетевой proxy          | TESTED      | Настоящий Chromium, изолированные контексты, token/CORS, сессии/лимиты, DNS-проверка и IP-pinning, private URL denial | Docker sandbox и публичный HTTPS требуют другого хоста; нет video/audio transport, downloads/uploads, WebSockets и persistent logins | [#4](https://github.com/romantic52/BROwOS/issues/4)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | 64 выполненных теста `tests/server`, включая 3 реальных Chromium-теста                                                                                          |
| CI и E2E workflows                    | TESTED      | Format/lint/typecheck/unit/integration/build/audit, browser acceptance, artifacts, Node 22/24                         | Дополнительная проверка доступности и других браузеров                                                                               | [#5](https://github.com/romantic52/BROwOS/issues/5)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | [CI #39100264368](https://github.com/romantic52/BROwOS/actions/runs/39100264368): Node 22/24 quality, server 64 passed, frontend 13 passed; artifacts сохранены |
| GitHub Pages                          | BLOCKED     | Публикация проверенного frontend artifact после CI основного commit                                                   | Нужна настройка Pages; admin endpoints connector недоступны, cloud browser timeout                                                   | [#5](https://github.com/romantic52/BROwOS/issues/5)                                                      | [#7](https://github.com/romantic52/BROwOS/pull/7) | [Deploy Pages #39100560196](https://github.com/romantic52/BROwOS/actions/runs/39100560196) failed на configure-pages; целевой адрес HTTP 404                    |
| Docker / Full Connected deployment    | BLOCKED     | Multi-stage images, приватная сеть Chromium, фильтрующий egress, nginx, HTTPS proxy example, seccomp и лимиты         | В рабочей среде нет Docker daemon; необходим доступный Docker-хост с DNS и sandbox                                                   | [#4](https://github.com/romantic52/BROwOS/issues/4), [#5](https://github.com/romantic52/BROwOS/issues/5) | [#7](https://github.com/romantic52/BROwOS/pull/7) | TypeScript build, deployment package и проверки конфигурации выполнены; image build/container run не выполнялись                                                |
| Remote VM                             | NOT STARTED | Issue и описанная граница режима                                                                                      | VM/provider, transport, authorization, интеграция и инфраструктура                                                                   | [#6](https://github.com/romantic52/BROwOS/issues/6)                                                      | —                                                 | Реализации и тестов нет                                                                                                                                         |

GitHub Issues [#1](https://github.com/romantic52/BROwOS/issues/1),
[#2](https://github.com/romantic52/BROwOS/issues/2) и
[#3](https://github.com/romantic52/BROwOS/issues/3) закрыты после доставки принятой
основы в `main`. Открыты [#4](https://github.com/romantic52/BROwOS/issues/4)
(production Connected acceptance), [#5](https://github.com/romantic52/BROwOS/issues/5)
(Pages delivery) и [#6](https://github.com/romantic52/BROwOS/issues/6) (Remote VM).
Границы UI-проверок и будущие функции в таблице сохраняются независимо от закрытия
задач первого этапа.

## Выполненные проверки и границы доказательств

Финальный полный локальный Vitest-прогон после последних изменений browser:
**210 passed, 0 failed, 0 skipped; 13 test files passed; exit 0**, 1,47 секунды.
В него входят файловые тесты (18), Window Manager (23), настройки ядра (5), общие
утилиты (23), приложения (44, включая 15 терминальных), интеграция файлов с
приложениями (4), browser client (29) и сервер (64). Это **210 уникальных тестов**;
повторные ссылки на наборы в таблице не увеличивают итог. Прогон выполнен с
`BROWOS_TEST_BROWSER_PATH=/tmp/browos-browser/chrome-linux64/chrome`,
`BROWOS_TEST_CHROMIUM=1`, `BROWOS_TEST_DISABLE_SANDBOX=1` командой `vitest run`;
реальные Chromium integration-тесты были включены.

Серверная часть полного прогона: **64 passed** — 50 тестов сетевой политики,
8 HTTP API, 3 proxy transport и 3 настоящих Chromium integration. Выполнены
server TypeScript build, ESLint и Prettier. Проверено создание production package
командой `pnpm deploy --prod --legacy`, используемой Dockerfile.

Chromium действительно открывал HTTP fixture, выполнял ввод/навигацию, создавал
JPEG и проверял изоляцию cookies и запрет private redirect. Тестовая среда
работает с UID 0; только тестовый конструктор разрешал отключение sandbox.
Production entrypoint такой настройки не имеет и оставляет sandbox обязательным.

Публичная HTTPS-проверка в текущей среде остановилась на отказе системного DNS.
Это не успешная интернет-навигация. Docker daemon отсутствует; контейнерная
приёмка должна быть выполнена на хосте развёртывания. Подробные команды и
критерии находятся в [CONNECTED.md](CONNECTED.md).

### Итог frontend E2E и доставки

Frontend проверен настоящим Chrome 151.0.7922.34 через Vite preview: **13 passed,
0 failed, 0 skipped**, 18,3 секунды, 2 workers. Прогон выполнен после последних
изменений browser. Использована свежая production
сборка и команда `playwright test --workers=2` со стандартными reporter проекта. Проверены окна,
виртуальные столы, файлы после reload, import/download с точным совпадением байтов,
UTF-8 текст, dirty guard, вычисления, пиксели Paint и PNG, терминал, воспроизведение
WAV, Local iframe/history/tabs/bookmarks и отсутствие токена в Web Storage.

В составе полного Vitest-прогона **29/29** тестов browser-client проверили транспорт и владение сессиями,
отмену/удаление, истечение, malformed responses и обработку ошибок. Scoped ESLint
клиента и полный TypeScript check прошли. Это не дополнительная сквозная проверка
публичного Connected-сайта.

Снимки из успешного `screenshots.spec.ts` сохранены в `docs/screenshots`.
Последний локальный прогон создал `playwright-report/index.html` и
`test-results/e2e.xml`. JUnit подтверждает: tests=13, failures=0, skipped=0,
errors=0, time=18.254698 s.

В GitHub [CI #39100264368](https://github.com/romantic52/BROwOS/actions/runs/39100264368) завершился **success**: quality checks Node 22/24,
**64 серверных теста**, включая настоящий Chromium, и **13 frontend E2E за 24,6 с**.
Run содержит artifacts `web-dist-…` и `browser-evidence-…` с production bundle
и доказательствами браузерных проверок. Эти повторные CI-прогоны не прибавляются
к числу 210 уникальных локальных Vitest-тестов.

Этот раздел дополняется подтверждением доставки текущего commit:

| Проверка                                          | Подтверждённый результат                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Полный локальный Vitest                           | 210 passed, 0 failed, 0 skipped; 13 файлов; включены integration и настоящий Chromium                                                                                                               |
| Browser client lifecycle tests                    | 29 passed внутри общего итога 210; scoped ESLint и полный TypeScript check passed                                                                                                                   |
| Полный frontend E2E на production bundle          | 13 passed, 0 failed, 0 skipped; Chrome 151.0.7922.34; 18,3 s                                                                                                                                        |
| Production build всей поставки                    | Общий production build прошёл; ESLint и полный TypeScript check прошли                                                                                                                              |
| Скриншоты из реального приложения                 | [desktop.png](screenshots/desktop.png) и [apps.png](screenshots/apps.png) из успешного E2E                                                                                                          |
| Последний доставленный функциональный commit / PR | [afa791f](https://github.com/romantic52/BROwOS/commit/afa791f7b6ee335dcfed5363f7f46e090575525e) в main; PR [#7](https://github.com/romantic52/BROwOS/pull/7) merged; 0.1.0 preview, без Release/tag |
| GitHub Actions                                    | [CI #39100264368](https://github.com/romantic52/BROwOS/actions/runs/39100264368) success; [CI main #39100459559](https://github.com/romantic52/BROwOS/actions/runs/39100459559) success             |
| GitHub Pages                                      | HTTP 404; [Deploy Pages #39100560196](https://github.com/romantic52/BROwOS/actions/runs/39100560196) failed на configure-pages: HttpError: Not Found                                                |

## Передача следующему рабочему сеансу

1. Открыть **Settings → Pages → Source → GitHub Actions** в `romantic52/BROwOS`.
   После включения повторить неудавшийся Deploy для того же актуального SHA
   `main`; если `main` изменится, дождаться CI новой версии и опубликовать её
   проверенный artifact. Затем проверить HTTP/UI целевого адреса. Connector текущего сеанса не предоставляет административные
   endpoints Pages; cloud browser при обращении к настройкам завис и завершился
   timeout. Это ограничение доступных инструментов; точное состояние deployment
   фиксируется отдельно. До успешной проверки адрес не является live demo.
2. На предоставленном Docker-хосте с DNS и HTTPS выполнить Connected acceptance:
   `docker compose build`, sandboxed startup, публичная HTTPS-страница,
   кадр/ввод, отказ private URL, лимиты/expiry. В текущей среде нет Docker daemon,
   а публичная HTTPS-проверка остановилась на системном DNS.
3. Закрывать Issues #4 и #5 после соответствующей серверной приёмки и публикации;
   для #6 сначала определить VM-инфраструктуру и реализовать адаптер.
4. Продолжать [ROADMAP.md](../ROADMAP.md) с ближайшей незакрытой Issue. Черновики,
   внешние плагины, синхронизация и Remote VM ещё не реализованы.

Последнее содержательное обновление: **2026-10-18**, первый автономный рабочий
сеанс. Фоновая разработка после окончания сеанса не обещается.

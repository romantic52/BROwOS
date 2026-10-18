# Changelog

Изменения BROwOS перечисляются по поведению продукта и инженерным границам.
Версия в манифестах — `0.1.0`; опубликованный GitHub Release и завершённое
развёртывание не подразумеваются наличием этого файла.

## 0.1.0 preview — поставлено в main

PR [#7](https://github.com/romantic52/BROwOS/pull/7) объединён, основная ветка проверена на commit [afa791f](https://github.com/romantic52/BROwOS/commit/afa791f7b6ee335dcfed5363f7f46e090575525e).
Это поставка исходников preview; отдельные GitHub Release и tag не создавались.

### Добавлено

- pnpm workspace с frontend React/TypeScript/Vite, Node backend и общими пакетами.
- Windows 10-подобная оболочка BROwOS: загрузка, Пуск, поиск, taskbar, уведомления,
  календарь, настройки и два виртуальных рабочих стола.
- Window Manager с фокусом, перемещением, изменением размера, сворачиванием,
  разворачиванием, левым/правым snap и проверяемым восстановлением сеанса.
- Постоянная VFS в IndexedDB: Blob-файлы, каталоги, copy/move/rename, Корзина,
  восстановление, permanent delete и JSON/base64 backup.
- Проводник с видами списка/плиток, поиском, сортировкой, множественным выбором,
  импортом/скачиванием и общим файловым clipboard.
- Блокнот, Калькулятор, Paint, Фотографии, Медиаплеер, Терминал, Параметры и
  Диспетчер задач на общих `DesktopServices`.
- BROwser с Local-вкладками, историей и постоянными закладками.
- Авторизованный Connected Chromium API: сессии, навигация, mouse/key/text/wheel,
  resize, история и JPEG-кадры.
- Docker-разделение frontend, Chromium и egress-прокси; конфигурация HTTPS proxy
  и установка закреплённого браузера с официальным fallback.
- CI, reusable E2E и Pages workflows, документация запуска, архитектуры, SDK и статуса.

### Надёжность и безопасность данных

- Все VFS-мутации проверяют актуальное дерево и фиксируются одной IndexedDB
  транзакцией; ошибки квоты отменяют частичные записи.
- Добавлены обновление других вкладок, защита системных папок, отказ циклических
  перемещений, валидация backup и добавляющий импорт с переназначением ID.
- Для редакторов реализована проверка конфликтующего `updatedAt` и подтверждение
  закрытия с несохранёнными изменениями.
- Восстановление окон проверяет app ID, размеры, z-index, фокус и ограниченный
  набор данных запуска.
- Калькулятор и терминал разбирают разрешённый ввод без `eval`, host shell и subprocess.
- Connected требует owner token, точный CORS allowlist, ограничивает запросы,
  размеры данных, очередь, число и время жизни сессий.
- Прокси проверяет DNS и закрепляет публичный IP сокета; private, loopback,
  metadata и специальные адреса блокируются, в том числе при редиректах.
- Production Chromium требует sandbox и не получает owner token в дочернем
  окружении. Тестовые overrides доступны только явно в тестовом конструкторе.

### Проверка

Полный локальный Vitest: **210/210 passed**, 13 файлов, без ошибок и пропусков;
включены 29 browser-client tests, 4 файловые интеграции и 64 серверные проверки
с тремя реальными Chromium-сценариями. Отдельно прошли **13/13 frontend E2E**
на production-сборке за **18,3 с**. Общий build, ESLint и TypeScript прошли.

[CI #39100264368](https://github.com/romantic52/BROwOS/actions/runs/39100264368) завершился **success**: Node 22/24 quality, **64 серверных теста** и
**13 frontend E2E за 24,6 с**. Созданы artifacts `web-dist-…` и
`browser-evidence-…`. Issues #1–#3 закрыты после доставки. В README включены
настоящие снимки рабочего стола и сохранённого документа. Повторный [CI main #39100459559](https://github.com/romantic52/BROwOS/actions/runs/39100459559) после merge также **success**.
Публикация Pages отслеживается в [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md).

### Известные незавершённые области

GitHub Pages вернул HTTP 404; [Deploy Pages #39100560196](https://github.com/romantic52/BROwOS/actions/runs/39100560196) завершился **failed** на
`configure-pages` с `HttpError: Not Found`. Следующий шаг — **Settings → Pages →
Source → GitHub Actions**, затем повторить Deploy актуального SHA или после
изменения `main` дождаться CI новой версии и публикации её artifact. Административные endpoints Pages в connector недоступны, а cloud
browser завершился timeout. Также остаются проверка Docker/sandbox и публичного
HTTPS на целевом хосте, более плавный
Connected-транспорт, remote download/upload/audio, синхронизация, устойчивые
черновики, изоляция сторонних приложений и Remote VM. Подробности — в
[ROADMAP.md](ROADMAP.md).

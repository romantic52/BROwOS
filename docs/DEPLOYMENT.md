# Развёртывание BROwOS

BROwOS поставляется как статический frontend и отдельный необязательный
Chromium-сервис. Frontend самостоятельно выполняет локальные файловые операции
и приложения. Для Connected-навигации требуется запущенный backend.

## Варианты запуска

| Вариант                              | Что работает                                                         | Что требуется                                                        |
| ------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Локальная разработка                 | Весь Local desktop, VFS, приложения, Local BROwser                   | Node.js 22.12+, pnpm 10.34.7, браузер                                |
| Статический hosting / GitHub Pages   | Production Local desktop с теми же локальными данными и приложениями | HTTPS static hosting и собранный `apps/web/dist`                     |
| Frontend + Connected server локально | Local desktop и настоящий отдельный Chromium                         | Дополнительно Chromium и Linux/другая среда с поддерживаемым sandbox |
| Full Connected через Docker          | Frontend/nginx, Chromium API, отдельный egress proxy                 | Docker Compose, sandbox на хосте, DNS; для удалённого доступа HTTPS  |
| Remote VM                            | Пока недоступно                                                      | Будущий VM backend и инфраструктура; в текущую поставку не входят    |

## Установка и локальный frontend

Получите исходный код из единственного официального репозитория:

```sh
git clone https://github.com/romantic52/BROwOS.git
cd BROwOS
corepack enable
corepack prepare pnpm@10.34.7 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Откройте `http://localhost:5173`. Если в вашей поставке Node отсутствует Corepack,
установите `pnpm@10.34.7` поддерживаемым пакетным менеджером, например
`npm install --global pnpm@10.34.7`, затем используйте те же команды pnpm.
Не обновляйте lockfile во время обычного развёртывания.

Для Local режима `.env` с секретами не требуется. Данные сохраняются в IndexedDB
браузера, а не в серверном каталоге или GitHub. Общий frontend не предоставляет
доступ к диску операционной системы: импорт и скачивание требуют действий
пользователя через браузер.

### Проверка production сборки

```sh
pnpm build:web
pnpm preview
```

Preview доступен на `http://localhost:4173`. Команда `pnpm build` собирает оба
приложения: frontend в `apps/web/dist` и сервер в `apps/server/dist`. Vite preview
предназначен для проверки сборки; для публичного hosting используйте static server.

Адрес, схема и порт определяют browser origin. Данные на `localhost:5173`,
`localhost:4173`, `127.0.0.1:5173` и GitHub Pages хранятся отдельно. Чтобы перенести
виртуальные файлы между origin или устройствами, экспортируйте backup в
Параметрах и импортируйте его в целевом экземпляре. Импорт добавляет данные с
новыми идентификаторами и не заменяет существующие файлы.

## Статический hosting

Публикуйте **содержимое** `apps/web/dist` после успешных проверок. Vite использует
относительный base `./`, поэтому bundle поддерживает путь проекта `/BROwOS/`.
Переменная `VITE_BASE_PATH` задаёт иной base при сборке, если это требуется вашему
hosting. Не помещайте токены или пароли в `VITE_*`: эти значения включаются в
публичный JavaScript.

Приложение использует browser storage, Blob URLs, Canvas и sandboxed iframe.
Static server должен отдавать корректные MIME-типы ресурсов. Используйте HTTPS
для удалённого доступа. Никакого Node.js процесса на стороне hosting для Local
режима не требуется.

### GitHub Pages

Целевой адрес: `https://romantic52.github.io/BROwOS/`.
Этот адрес считается опубликованной демонстрацией только после успешного
deployment и проверки загрузки реального приложения. Текущий подтверждённый
результат фиксируется в [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

Workflow [deploy.yml](../.github/workflows/deploy.yml) использует GitHub Actions
как источник Pages:

1. [CI](../.github/workflows/ci.yml) проверяет исходники и собирает frontend.
   Его job E2E принимает этот же production artifact.
2. Deploy реагирует на успешное завершение CI push в `main` официального
   репозитория. Результаты PR и постороннего репозитория не публикуются.
3. Workflow сравнивает проверенный SHA с актуальным `main`, скачивает artifact
   `web-dist-<SHA>` из соответствующего CI run и передаёт его Pages.
4. Перед публикацией SHA проверяется повторно. Workflow с правами Pages не
   исполняет исходники приложения и не пересобирает непроверенный bundle.

В настройках репозитория Pages должен быть включён источник **GitHub Actions**.
Workflow использует `configure-pages` с `enablement: false`: он не пытается
обойти отсутствие настройки или административных прав. Environment
`github-pages` может иметь дополнительные разрешения или review gates, заданные
владельцем. Их нужно учитывать при фактическом запуске.

Проверка публикации включает успешный Actions run, успешный deployment на его SHA,
HTTP-загрузку страницы и ресурсов, открытие рабочего стола и сохранение/повторное
открытие тестового документа. Ссылка на workflow сама по себе не подтверждает
работу сайта.

GitHub Pages не запускает Node.js backend, серверный Chromium или VM. Connected
клиент статического frontend может обращаться к отдельно размещённому HTTPS API.
Для такого случая разрешённый CORS origin — `https://romantic52.github.io`,
без пути `/BROwOS/`.

### Оформление официального репозитория

Проверка GitHub API после первой поставки показала `description: null`, пустой
список `topics` и `has_pages: false`. Подключённый инструмент позволяет доставлять
исходники, PR и Issues, но не предоставляет операций изменения этих
административных настроек. Облачный браузер не вернул страницу настроек;
изменение About и включение Pages не объявляются выполненными.

Для следующего доступа к настройкам сохранены точные значения владельца.
В **About → Edit** официального `romantic52/BROwOS` задайте описание:

> BROwOS — a browser-based Windows 10-inspired desktop operating environment with virtual filesystem, applications, multitasking and integrated web browsing.

Topics:

```text
browos, webos, web-desktop, operating-system, windows-10, react,
typescript, virtual-filesystem, browser-os, web-app, desktop-environment
```

Для публикации один раз выберите **Settings → Pages → Build and deployment →
Source → GitHub Actions**. Затем повторите неудавшийся Deploy текущего `main`;
если основная ветка уже изменилась, используйте успешный CI её новой версии.
Описание и topics не влияют на сборку, но остаются незавершённой частью оформления.

## Connected разработка без Docker

Полное руководство, API, лимиты и проверки находятся в [CONNECTED.md](CONNECTED.md).
Краткая последовательность:

```sh
cp .env.example .env
pnpm --filter @browos/server exec playwright install chromium
pnpm dev:server
```

Перед запуском задайте в приватном `.env` `BROWOS_ACCESS_TOKEN` из не менее 32
случайных символов. Для Compose также понадобится отдельный
`BROWOS_EGRESS_PROXY_TOKEN`. Секреты генерируются владельцем и не входят в Git.
Пример команды локальной генерации приведён в Connected-руководстве.

В другом терминале выполните `pnpm dev`. В BROwser выберите Connected, укажите
`http://127.0.0.1:3001` и введите owner token. Разрешённые origins в
`BROWOS_ALLOWED_ORIGINS` должны точно соответствовать адресу frontend, включая
порт. Сервер по умолчанию слушает loopback.

Production запуск скомпилированного сервера из корня репозитория:

```sh
pnpm --filter @browos/server build
node --env-file=.env apps/server/dist/index.js
```

Сервер запускает Chromium лениво при создании сессии. Ответ `/health` проверяет
доступность API, но не поддержку sandbox. Используйте непривилегированного
пользователя и поддерживаемую среду Chromium. Production не отключает sandbox
автоматически при ошибке запуска.

## Full Connected Edition через Docker

Подготовленные файлы:

| Файл                                                   | Назначение                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| [docker-compose.yml](../docker-compose.yml)            | Frontend, Chromium и отдельный фильтрующий proxy; network/resource limits |
| [web.Dockerfile](../docker/web.Dockerfile)             | Сборка frontend и непривилегированный nginx                               |
| [server.Dockerfile](../docker/server.Dockerfile)       | TypeScript build, production dependencies, browser/proxy targets          |
| [nginx.conf](../docker/nginx.conf)                     | Статика и маршруты `/api/`, `/health`                                     |
| [Caddyfile.example](../docker/Caddyfile.example)       | Пример внешнего HTTPS reverse proxy                                       |
| [seccomp_profile.json](../docker/seccomp_profile.json) | Профиль для Chromium user namespaces с сохранённым upstream notice        |

После заполнения приватного `.env`:

```sh
docker compose build
docker compose up -d
docker compose ps
```

Frontend доступен на `http://localhost:8080`. Для Connected укажите тот же адрес:
nginx передаёт API-запросы внутреннему сервису. Если используется
`http://127.0.0.1:8080`, задайте этот точный origin в `BROWOS_PUBLIC_ORIGIN`.

Контейнер Chromium подключён к внутренней Docker-сети; публичный исходящий трафик
проходит через отдельный proxy с проверкой адреса и закреплением проверенного IP.
API и proxy не публикуют host ports. На хост публикуется только loopback-порт
frontend, а удалённый доступ предоставляет внешний HTTPS reverse proxy.

Для публичного личного развёртывания нужны конкретные внешние ресурсы:

- Linux/Docker-хост с рабочими DNS и Chromium sandbox;
- доменное имя и DNS-запись, указывающая на этот хост;
- HTTPS reverse proxy и точный `BROWOS_PUBLIC_ORIGIN`;
- сгенерированные владельцем API и proxy credentials.

Репозиторий не покупает сервер или домен и не содержит чужие учётные данные.
Full Connected рассчитан на авторизованное использование одним владельцем.
Не публикуйте токен в URL, source, screenshots, Actions output или клиентской
конфигурации сборки.

### Обязательная приёмка на целевом хосте

В текущем рабочем сеансе выполнены реальный Chromium fixture test, серверные
API/network/transport tests и сборка TypeScript. Docker daemon отсутствовал,
поэтому успешная сборка образов и контейнерный sandbox ещё не подтверждены.
Публичный HTTPS smoke был заблокирован отказом системного DNS текущей среды.

На целевом хосте выполните checklist из [CONNECTED.md](CONNECTED.md): создание
авторизованной сессии, публичная HTTPS-навигация, JPEG и ввод, отказ private URL,
отказ неверного токена, expiry и cleanup. Запишите результат и commit в
DEVELOPMENT_STATUS. Не заменяйте эту проверку одним `/health`.

## Обновления и данные

Перед обновлением frontend сохраните backup важных виртуальных файлов в
Параметрах. Обновление статики не должно очищать IndexedDB; данные браузера могут
быть удалены пользователем, приватным режимом или механизмами browser storage.
Они не входят в backup сервера или Docker volume.

Connected-сессии в текущей версии временные. Перезапуск, удаление или истечение
сессии уничтожают её cookies/storage; сохранённые серверные профили отсутствуют.
Не используйте перезапуск сервиса как способ сохранить состояние удалённого сайта.

Для обновления исходного кода используйте обычный Git pull принятой ветки,
`pnpm install --frozen-lockfile`, проверки и новую сборку. Историю репозитория
переписывать не требуется. На Docker-хосте пересоберите и перезапустите Compose
после успешной приёмки конфигурации. Не монтируйте Docker socket или пользовательские
домашние каталоги внутрь браузерного контейнера.

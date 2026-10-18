# BROwOS Connected Edition

Connected Edition runs a real, separate Chromium browser on your server. The
BROwOS browser application sends authenticated navigation and input commands and
displays JPEG frames from that browser. Websites run in Chromium, with their
ordinary JavaScript and layout. This service is not a Windows virtual machine
and cannot run Windows executables.

The static GitHub Pages edition does not start a backend. It can use its local
iframe mode, or connect to a separately deployed HTTPS Chromium service.

## What is implemented

| Capability                        | Current behavior                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| HTTP / HTTPS navigation           | Real Chromium navigation through a filtered, authenticated egress proxy                           |
| Remote input                      | Mouse move/click, wheel, text insertion, browser keys and shortcuts                               |
| History                           | Back, forward and reload in each browser session                                                  |
| Viewport                          | 320–1920 px wide, 240–1080 px high; JPEG screenshot frames                                        |
| Session state                     | Separate ephemeral Chromium context, cookies and storage per session                              |
| Authentication                    | Single-owner bearer token, required for every session API call                                    |
| Expiration                        | 10 minutes without input/navigation; absolute lifetime 1 hour by default                          |
| Concurrency                       | Up to 4 sessions by default, with a bounded operation queue                                       |
| Network policy                    | Public HTTP/80 and HTTPS/443 only; DNS results validated and connections pinned to the checked IP |
| Downloads / uploads               | Disabled; no host file picker or remote-file export                                               |
| Popups / dialogs                  | Extra windows are closed; JavaScript dialogs are dismissed                                        |
| WebSockets / service workers      | Disabled in this initial edition                                                                  |
| Audio, microphone, camera, WebRTC | No audio transport; no permission grants; non-proxied WebRTC UDP disabled                         |
| Persistent logins                 | Not retained after session expiration, deletion or a service restart                              |
| Remote VM                         | Not implemented; not advertised as an available runtime                                           |

JPEG polling is a functional remote viewport, not a low-latency video protocol.
Sites requiring WebSockets, DRM, audio, popups, uploads or continuous downloads
can be incomplete. Large resources/tunnels have a 64 MiB transfer limit.

## Local development

Requirements: Node.js 22.12 or later, pnpm 10, and a host that supports the
Chromium sandbox. Do not run the production browser service as root.

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env`. Generate **two different** random secrets of at
   least 32 characters. Put them in `BROWOS_ACCESS_TOKEN` and
   `BROWOS_EGRESS_PROXY_TOKEN`. Never put either value in a `VITE_*` variable.
3. Install Chromium with `pnpm --filter @browos/server exec playwright install chromium`.
   On Linux, `playwright install --with-deps chromium` can also install required
   operating-system libraries, with the necessary administrator privileges.
4. Run `pnpm dev` for the desktop and `pnpm dev:server` in a second terminal.
   The development server reads the root `.env` file. The API binds to
   `127.0.0.1:3001` unless explicitly configured otherwise.
5. In BROwOS Browser's Connected settings, enter `http://127.0.0.1:3001` as the
   service URL and enter your owner access token. Keep this token private.

Generate one random secret locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The egress proxy starts automatically on a random loopback port for local
development. It uses a separate temporary credential. The `.env` egress token
is used by the Docker deployment, where the proxy is a separate service.

For a compiled server, run `pnpm --filter @browos/server build`, then from the
repository root run:

```sh
node --env-file=.env apps/server/dist/index.js
```

`GET /health` confirms API availability. It does not prove that the host supports
the Chromium sandbox: a browser is launched only when the first session is
created. A launch failure returns `503 BROWSER_UNAVAILABLE` with no fallback
to an unsandboxed production browser.

## Docker deployment

The repository includes multi-stage Docker builds and a Compose deployment:

- `web`: an unprivileged Nginx frontend/reverse proxy, exposed only at
  `127.0.0.1:8080` on the host.
- `chromium`: an unprivileged Node/Chromium service on an **internal Docker
  network**, with no direct internet route and no host-published API port.
- `egress`: a separately authenticated proxy, connected to the internal browser
  network and an internet egress network. Its port is not published on the host.

Create the private `.env` credentials described above, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
```

Open `http://localhost:8080`. For Connected mode, use
`http://localhost:8080` as the service URL; `/api/` is reverse-proxied to the
Chromium service. Set `BROWOS_PUBLIC_ORIGIN=http://127.0.0.1:8080` instead if you
intend to open that exact origin. Origins are exact, including the port.

The Chromium container enables `chromiumSandbox: true`, runs as the `node` user,
drops Linux capabilities, has read-only application files, bounded temporary
storage, memory/CPU/process limits and an upstream seccomp profile that permits
Chromium user namespaces. The host kernel must support this sandbox. The
configuration does not use `--privileged`, `SYS_ADMIN`, `seccomp=unconfined`,
`network_mode: host`, a Docker socket mount or a production `--no-sandbox` flag.

The image and browser are pinned through Playwright `1.62.1`. The build first
uses Playwright's official installer. If that CDN fails, Linux x64 builds can
fetch the exact `browserVersion` from Google's official Chrome for Testing
storage. The fallback validates archive paths and uses the expected Playwright
executable location; it does not silently select a different browser version.
The service uses Chromium's current headless mode (`channel: chromium`).

This workspace did not provide a Docker daemon, so a successful image build and
container sandbox launch are **not claimed**. The files are ready for the
deployment host's `docker compose build` and acceptance checks below.

An additional public HTTPS smoke check could not resolve `example.com` through
this workspace's system DNS. The service failed closed at destination resolution.
Public internet navigation therefore remains a deployment-host acceptance check;
the successful Chromium tests used real, explicitly permitted local fixtures.

### Public HTTPS access

For an internet-accessible private deployment, provide a host, a DNS name and
an HTTPS reverse proxy. `docker/Caddyfile.example` shows a host-side Caddy
configuration. Set `BROWOS_PUBLIC_ORIGIN` to the exact public HTTPS frontend
origin, for example `https://browos.example.com`, before starting Compose.

Keep the Compose port bound to loopback. Terminate TLS at Caddy or an equivalent
host proxy and forward to `127.0.0.1:8080`. The API token must travel over HTTPS
for remote use. If the frontend is hosted separately on GitHub Pages, include
its exact origin in the API allowlist and give the frontend the server's HTTPS
service URL. A Pages origin has no `/BROwOS/` path component, for example
`https://romantic52.github.io`.

The missing external deployment inputs are an available server with Docker and
sandbox support, its domain/DNS/TLS configuration, and owner-generated private
credentials. No paid host, domain or certificate service is purchased by this
repository. The deployment is intended for one owner's private use, not an
anonymous browser hosting service.

## Configuration

| Variable                                  | Default / requirement                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BROWOS_ACCESS_TOKEN`                     | Required, 32–256 non-whitespace characters; owner API credential                                                                          |
| `BROWOS_ALLOWED_ORIGINS`                  | `http://localhost:5173,http://127.0.0.1:5173`; comma-separated exact origins, no wildcard or trailing slash; remote origins require HTTPS |
| `BROWOS_HOST`                             | `127.0.0.1`; Compose explicitly uses `0.0.0.0` inside its isolated network                                                                |
| `BROWOS_PORT`                             | `3001`                                                                                                                                    |
| `BROWOS_MAX_SESSIONS`                     | `4`, permitted range 1–16                                                                                                                 |
| `BROWOS_IDLE_TIMEOUT_MS`                  | `600000`, permitted range 10000–3600000                                                                                                   |
| `BROWOS_MAX_LIFETIME_MS`                  | `3600000`, permitted range 60000–86400000                                                                                                 |
| `BROWOS_NAVIGATION_TIMEOUT_MS`            | `15000`, permitted range 1000–30000                                                                                                       |
| `BROWOS_REQUESTS_PER_MINUTE`              | `600`, permitted range 30–1800                                                                                                            |
| `BROWOS_PUBLIC_ORIGIN`                    | Compose frontend origin; defaults to `http://localhost:8080`                                                                              |
| `BROWOS_EGRESS_PROXY_URL`                 | Optional trusted HTTP proxy URL; otherwise create a local filtered proxy                                                                  |
| `BROWOS_EGRESS_PROXY_TOKEN`               | Required for the separate proxy; different from the API credential                                                                        |
| `BROWOS_PROXY_HOST` / `BROWOS_PROXY_PORT` | Proxy process bind, default `127.0.0.1:3128`; Compose uses internal `0.0.0.0:3128`                                                        |

Compose uses `BROWOS_PUBLIC_ORIGIN` as the container's allowlist; it intentionally
does not inherit the development `.env` localhost:5173 allowlist. For multiple
trusted HTTPS frontend origins, set the Compose environment value to an explicit
comma-separated list.

## HTTP API contract

API base examples: `http://127.0.0.1:3001` in local development, or your HTTPS
origin in a reverse-proxied deployment. Every `/api/*` request requires:

```http
Authorization: Bearer YOUR_PRIVATE_ACCESS_TOKEN
```

POST requests require `Content-Type: application/json`; the JSON body limit is
16 KiB. Tokens in query parameters are not accepted. CORS allows only the exact
configured origins and the `Authorization` / `Content-Type` request headers.
The client fetches frames as authenticated blobs and creates a local object URL;
it must not embed a token into an image URL.

| Method | Path                         | Request                         | Response                                                  |
| ------ | ---------------------------- | ------------------------------- | --------------------------------------------------------- |
| GET    | `/health`                    | No authentication needed        | `{status:"ok",service:"browos-chromium",version:"0.1.0"}` |
| POST   | `/api/sessions`              | `{width?:1280,height?:720}`     | 201 session snapshot                                      |
| GET    | `/api/sessions/:id`          | —                               | 200 session snapshot                                      |
| POST   | `/api/sessions/:id/navigate` | `{url:"https://example.com"}`   | 200 session snapshot                                      |
| POST   | `/api/sessions/:id/action`   | One action from the table below | 200 session snapshot                                      |
| GET    | `/api/sessions/:id/frame`    | —                               | 200 `image/jpeg`, `Cache-Control: no-store`               |
| DELETE | `/api/sessions/:id`          | —                               | 204; context and associated state destroyed               |

A session snapshot is:

```json
{
  "id": "o4iqNoGeSzGPYkBtBjc5nKdwR0F8We1V",
  "url": "about:blank",
  "title": "",
  "width": 1280,
  "height": 720,
  "createdAt": "2026-01-01T12:00:00.000Z",
  "lastActivityAt": "2026-01-01T12:00:00.000Z"
}
```

The ID above illustrates the field, not an existing session. Actual IDs are
24 random bytes encoded as 32 URL-safe characters. History actions are available;
`canGoBack` / `canGoForward` booleans are not exposed in this version.

| Action                        | Request fields                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `click`                       | `x`, `y`, optional `button`: `left` / `middle` / `right`, optional `clickCount`: 1 or 2 |
| `move`                        | `x`, `y`                                                                                |
| `wheel`                       | `deltaX`, `deltaY`, each between -5000 and 5000                                         |
| `text`                        | `text`, at most 2048 characters; inserts into the currently focused element             |
| `key`                         | `key`, for example `Enter`, `Tab`, `Backspace`, `ArrowLeft`, `Control+A`, `Meta+A`      |
| `back` / `forward` / `reload` | No additional fields                                                                    |
| `resize`                      | `width`, `height`, within the viewport bounds                                           |

Pointer coordinates use the remote viewport's natural pixels, not the scaled
image's displayed CSS pixels. The client should convert using the image's
displayed rectangle. Poll frames at a modest rate, typically 1–2 per second,
and stop polling after disconnect or component unmount. Frame polling and
metadata reads do not extend the idle lifetime; input and navigation do.

Errors have a stable envelope:

```json
{
  "error": {
    "code": "URL_BLOCKED",
    "message": "Local, private and special-use network addresses are blocked."
  }
}
```

Typical statuses are 400 for invalid input/blocked URLs, 401 for authentication,
403 for a disallowed origin, 404 for missing or expired sessions, 413 for a large
body, 415 for a wrong content type, 429 for rate/concurrency limits, and 503 if
Chromium cannot start. Browser failures return sanitized 502 errors. Raw browser
logs, server environment variables and authentication tokens are not returned.

## Network and session boundaries

The proxy validates each new upstream connection. It rejects private, loopback,
link-local, multicast, documentation, transition and other special-use address
ranges, including decimal/hex loopback URLs and IPv4-mapped IPv6. A DNS name with
even one prohibited answer is rejected. The proxy then opens the socket to the
validated numeric address, preserving the original HTTP Host or the HTTPS
tunnel; it never performs a second unchecked hostname resolution. Redirects and
subresources go through the same proxy. TLS certificate checks remain enabled.

HTTP proxy credentials are consumed by the proxy and removed from upstream
requests. The Chromium child receives a small operating-system environment,
without the owner's access token. Chromium uses a pipe connection to Playwright;
no DevTools or Playwright control port is exposed to the frontend.

Each context belongs to the authenticated owner credential and has a random ID.
The server is a single-owner service: possession of the owner token grants access
to that owner's sessions. It is not a multi-user authentication system.
Rotating the token means changing the private deployment secret and restarting
the service, which destroys all ephemeral contexts.

The proxy and Chromium sandbox reduce separate classes of risk. Docker's
internal browser network also blocks direct internet routing around the proxy.
This is not a guarantee against an unknown Chromium/kernel exploit. Keep the
host and pinned browser version maintained; use a dedicated host or VM if the
deployment needs stronger isolation from other workloads.

## Verification and acceptance

The following tests are present and were executed during initial development:

- 50 address, URL, DNS-rebinding, configuration and input-boundary tests.
- 8 HTTP API tests covering authentication, exact CORS, body limits, frame
  responses, actions, deletion, request limits and sanitized errors.
- 3 real egress-proxy transport tests, including a nonexistent fixture hostname
  that succeeds only because the proxy connects to its validated numeric IP.
- 3 real Chromium integration tests: page rendering/input/JPEG/lifecycle,
  cookie isolation/history/session caps, and a prohibited redirect whose private
  target receives zero requests.

The 64 tests passed together. The workspace runs as root, which Chromium itself
refuses with its sandbox enabled. Only the controlled local integration fixtures
used a constructor-injected test override for that environment. This does not
verify production container sandbox behavior, and there is no corresponding
production environment flag or automatic fallback.

Run ordinary tests with:

```sh
pnpm exec vitest run tests/server
```

The three real-browser tests are explicitly skipped unless requested. On a
normal non-root host with installed Chromium, run:

```sh
BROWOS_TEST_CHROMIUM=1 pnpm exec vitest run tests/server
```

For a controlled root-only test runner, `BROWOS_TEST_DISABLE_SANDBOX=1` is read
only by the test fixture. `BROWOS_TEST_BROWSER_PATH` optionally supplies the
matching official test executable. The server entrypoint does not read either
variable, and its constructor rejects test overrides outside `NODE_ENV=test`.

Before exposing a deployment, check the build and API on the deployment host,
create a session, navigate to a public HTTPS page, verify its JPEG, then confirm
that `http://169.254.169.254/` is refused. Confirm the Chromium container has only
the internal browser network and no published port. Delete the session after
the check. CI success for local/browser tests alone must not be reported as a
verified external deployment.

## References

- [Playwright Docker and sandbox guidance](https://playwright.dev/docs/docker)
- [Chromium launch options](https://playwright.dev/docs/api/class-browsertype#browser-type-launch)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [Playwright network control](https://playwright.dev/docs/network)
- [Chrome for Testing official download data](https://googlechromelabs.github.io/chrome-for-testing/)

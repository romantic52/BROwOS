# Docker dependency notices

`seccomp_profile.json` is the Chromium sandbox profile distributed by Microsoft
Playwright, retained from the `v1.62.1` tag:

https://github.com/microsoft/playwright/blob/v1.62.1/utils/docker/seccomp_profile.json

The upstream Apache 2.0 license is retained in `PLAYWRIGHT_LICENSE.txt`. It applies
to the upstream material and does not assign an open-source license to BROwOS.
The BROwOS owner decides the license for BROwOS-authored code.

The profile uses a deny-by-default syscall policy and the namespace permissions
recommended by Playwright for a non-root Chromium sandbox. Other container
dependencies retain their respective upstream licenses.

Reference: https://playwright.dev/docs/docker

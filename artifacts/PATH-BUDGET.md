# Explicit evidence path budget

This is the budget for the exact delivery exceptions added to `.gitignore`. The repository otherwise excludes new files under `artifacts/`. No Git metadata exclusion was edited.

Only the files below may be newly included by this exception. Aggregate ceiling: **1,600,000 bytes**; sum of individual ceilings: **1493504 bytes**. Existing tracked artifacts remain preserved and also count toward the separate **8,388,608-byte complete payload limit**. Dependency, browser, cache and registry directories are never included.

| Path | Maximum bytes |
| --- | ---: |
| `artifacts/PATH-BUDGET.md` | 8192 |
| `artifacts/hosting-request.json` | 512 |
| `artifacts/screenshots/sweepdust-1440-confirmed-fixture.png` | 262144 |
| `artifacts/screenshots/sweepdust-1440-live.png` | 524288 |
| `artifacts/screenshots/sweepdust-320-long-review.png` | 98304 |
| `artifacts/screenshots/sweepdust-390-first.png` | 65536 |
| `artifacts/screenshots/sweepdust-390-keyboard-focus.png` | 98304 |
| `artifacts/validation.md` | 24576 |
| `artifacts/validation/bundle-budget.json` | 8192 |
| `artifacts/validation/chromium-axe-connected.json` | 2048 |
| `artifacts/validation/chromium-axe-disconnected.json` | 2048 |
| `artifacts/validation/chromium-axe-review.json` | 2048 |
| `artifacts/validation/chromium-contrast.json` | 4096 |
| `artifacts/validation/chromium-results.json` | 32768 |
| `artifacts/validation/export.json` | 8192 |
| `artifacts/validation/fork.json` | 8192 |
| `artifacts/validation/live-browser.json` | 4096 |
| `artifacts/validation/live-scan.json` | 131072 |
| `artifacts/validation/performance.json` | 2048 |
| `artifacts/validation/taste.json` | 131072 |
| `artifacts/validation/unit-results.txt` | 32768 |
| `artifacts/validation/webkit-axe-connected.json` | 2048 |
| `artifacts/validation/webkit-axe-disconnected.json` | 2048 |
| `artifacts/validation/webkit-axe-review.json` | 2048 |
| `artifacts/validation/webkit-contrast.json` | 4096 |
| `artifacts/validation/webkit-results.json` | 32768 |

Actual totals, the Git-visible file count and the conservative stored-ZIP payload size are recorded in `artifacts/validation/bundle-budget.json`. The ZIP is disposable scratch scaffolding and is not submitted.

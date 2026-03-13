# v0.2.83 (2026-03-13)

## New Providers

- **Added DeepSeek provider**: Full support for DeepSeek API with OpenAI-compatible format (`deepseek/deepseek-chat`, `ds/deepseek-chat`)
- **Added Groq provider**: Support for Groq's fast inference API (`groq/llama-3.3-70b`, etc.)
- **Added xAI (Grok) provider**: Support for xAI's Grok models (`xai/grok-2`, etc.)
- **Added Cerebras provider**: Support for Cerebras fast inference (`cerebras/llama-3.3-70b`, etc.)
- **Added Mistral provider**: Support for Mistral AI models (`mistral/mistral-large-latest`, etc.)

## Fixes

- **Fixed provider routing configuration**: Added missing `PROVIDERS` config entries for API key-based providers that were causing routing failures
- **Improved provider model resolution**: Enhanced `getModelInfo()` to correctly resolve provider nodes and aliases

## Technical Details

- `open-sse/config/constants.js`: Added configuration entries for `deepseek`, `groq`, `xai`, `cerebras`, `mistral`
- `src/shared/constants/providers.js`: Provider definitions already present, now properly linked to executor config
- `open-sse/config/providerModels.js`: Model mappings already present for new providers

# v0.2.82 (2026-03-02)

## Stability & Memory Fixes

- **Resolved system-blocking memory leaks**: Implemented several critical fixes for long-running `next-server` stability.
- **Optimized Database Access**: Added a 2-second TTL cache to `localDb.js` reads. Previously, every API call triggered a full disk read and JSON parse of `db.json`, causing massive CPU/RAM spikes and system freezes under load.
- **Model Lock Garbage Collection**: Added a background GC process to `auth.js` to automatically clear expired model-level rate limit locks. Prevents infinite memory growth of the `modelLocks` Map.
- **Safe Timer Management**: Fixed timer leaks in `tokenRefreshScheduler.js` by ensuring previous intervals are cleared before re-initialization.
- **MITM Proxy Optimization**: Disabled heavy JSON logging to disk by default in `mitm/server.js`. Improved memory handling during request interception.

## Technical Details

- `src/lib/localDb.js`: Implemented `lastReadTime` throttling for `getDb()` singleton.
- `src/sse/services/auth.js`: Added `globalThis._modelLocksGC` interval (5m).
- `src/mitm/server.js`: Switched `ENABLE_FILE_LOG` to environment-gated default (false).
- `src/shared/services/tokenRefreshScheduler.js`: Added `clearInterval` safety in `start()`.

# v0.2.81 (2026-02-24)

## Fixes
- **Fixed database persistence detection**: Corrected `isCloud` check in `localDb.js` to properly distinguish between Edge/Worker environments and Next.js Node.js runtime. Previously, Next.js polyfills incorrectly triggered in-memory mode, causing all credentials to be lost on server restart.
- **Fixed missing cloud credential import**: Added logic to `updateLocalTokens()` to import credentials from cloud that are missing locally. Ensures credentials are properly restored on first boot or after database reset.
- **Fixed concurrent token refresh race condition**: Implemented distributed locking using database state (`refreshLockedUntil`) to prevent multiple Next.js workers from attempting simultaneous OAuth token refreshes. Prevents `invalid_grant` errors that were destroying authentication state.

## Technical Details
- `src/lib/localDb.js`: Changed `isCloud` detection from `typeof caches !== 'undefined'` to `typeof process === 'undefined' || process.env.NEXT_RUNTIME === 'edge'`
- `src/app/api/sync/cloud/route.js`: Added second loop in `updateLocalTokens()` to create missing provider connections from cloud data
- `src/shared/services/tokenRefreshScheduler.js`: Added database-backed distributed locking with 60-second lock timeout to coordinate token refresh across workers

# v0.2.66 (2026-02-06)

## Features
- Added Cursor provider end-to-end support, including OAuth import flow and translator/executor integration (`137f315`, `0a026c7`).
- Enhanced auth/settings flow with `requireLogin` control and `hasPassword` state handling in dashboard/login APIs (`249fc28`).
- Improved usage/quota UX with richer provider limit cards, new quota table, and clearer reset/countdown display (`32aefe5`).
- Added model support for custom providers in UI/combos/model selection (`a7a52be`).
- Expanded model/provider catalog:
  - Codex updates: GPT-5.3 support, translation fixes, thinking levels (`127475d`)
  - Added Claude Opus 4.6 model (`e8aa3e2`)
  - Added MiniMax Coding (CN) provider (`7c609d7`)
  - Added iFlow Kimi K2.5 model (`9e357a7`)
  - Updated CLI tools with Droid/OpenClaw cards and base URL visibility improvements (`a2122e3`)
- Added auto-validation for provider API keys when saving settings (`b275dfd`).
- Added Docker/runtime deployment docs and architecture documentation updates (`5e4a15b`).

## Fixes
- Improved local-network compatibility by allowing auth cookie flow over HTTP deployments (`0a394d0`).
- Improved Antigravity quota/stream handling and Droid CLI compatibility behavior (`3c65e0c`, `c612741`, `8c6e3b8`).
- Fixed GitHub Copilot model mapping/selection issues (`95fd950`).
- Hardened local DB behavior with corrupt JSON recovery and schema-shape migration safeguards (`e6ef852`).
- Fixed logout/login edge cases:
  - Prevent unintended auto-login after logout (`49df3dc`)
  - Avoid infinite loading on failed `/api/settings` responses (`01c9410`)

# v0.2.56 (2026-02-04)

## Features
- Added Anthropic-compatible provider support across providers API/UI flow (`da5bdef`).
- Added provider icons to dashboard provider pages/lists (`60bd686`, `8ceb8f2`).
- Enhanced usage tracking pipeline across response handlers/streams with buffered accounting improvements (`a33924b`, `df0e1d6`, `7881db8`).

## Fixes
- Fixed usage conversion and related provider limits presentation issues (`e6e44ac`).

# v0.2.52 (2026-02-02)

## Features
- Implemented Codex Cursor compatibility and Next.js 16 proxy migration updates (`e9b0a73`, `7b864a9`, `1c6dd6d`).
- Added OpenAI-compatible provider nodes with CRUD/validation/test coverage in API and UI (`0a28f9f`).
- Added token expiration and key-validity checks in provider test flow (`686585d`).
- Added Kiro token refresh support in shared token refresh service (`f2ca6f0`).
- Added non-streaming response translation support for multiple formats (`63f2da8`).
- Updated Kiro OAuth wiring and auth-related UI assets/components (`31cc79a`).

## Fixes
- Fixed cloud translation/request compatibility path (`c7219d0`).
- Fixed Kiro auth modal/flow issues (`85b7bb9`).
- Included Antigravity stability fixes in translator/executor flow (`2393771`, `8c37b39`).

# v0.2.43 (2026-01-27)

## Fixes
- Fixed CLI tools model selection behavior (`a015266`).
- Fixed Kiro translator request handling (`d3dd868`).

# v0.2.36 (2026-01-19)

## Features
- Added the Usage dashboard page and related usage stats components (`3804357`).
- Integrated outbound proxy support in Open SSE fetch pipeline (`0943387`).
- Improved OpenAI compatibility and build stability across endpoint/profile/providers flows (`d9b8e48`).

## Fixes
- Fixed combo fallback behavior (`e6ca119`).
- Resolved SonarQube findings, Next.js image warnings, and build/lint cleanups (`7058b06`, `0848dd5`).

# v0.2.31 (2026-01-18)

## Fixes
- Fixed Kiro token refresh and executor behavior (`6b22b1f`, `1d481c2`).
- Fixed Kiro request translation handling (`eff52f7`, `da15660`).

# v0.2.27 (2026-01-15)

## Features
- Added Kiro provider support with OAuth flow (`26b61e5`).

## Fixes
- Fixed Codex provider behavior (`26b61e5`).

# v0.2.21 (2026-01-12)

## Changes
- README updates.
- Antigravity bug fixes.

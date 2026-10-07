# WebView / Web Frontend Dependency Audit

## Summary

LifeTrace Desktop is a Tauri application, so React is naturally rendered by the operating-system WebView used by Tauri. That WebView is expected and is not the dependency this refactor removes.

The audit found **no Desktop architecture that embeds the public LifeTrace Web application through an iframe, remote WebView URL, or remote LifeTrace page shell**.

The actual historical coupling was source/build reuse of `vendor/web`, plus reuse of localhost HTTP as a packaged Desktop JSON transport. Both have now been removed from the primary Desktop path.

## Audit Classification

| Dependency / boundary | Historical reason | Final Desktop implementation | Status |
| --- | --- | --- | --- |
| `DesktopCloudWorkspace -> vendor/web AppContext` | Reuse Web state container | Desktop stores/native workspace | Removed |
| `DesktopCloudWorkspace -> DesktopFeatureRouter` | Reuse Web routes/pages | `DesktopNativeRouteContent` + native navigation | Removed |
| `DesktopCloudWorkspace -> CloudDataStore` | Cloud state drove authenticated UI | SQLite/local-first UI + Sync | Removed |
| Tauri entry -> Web global styles | Reuse Web visual contract | Desktop CSS/tokens | Removed |
| Desktop TypeScript -> `vendor/web/src` | Compile reused Web pages | Desktop sources only | Removed |
| Vite/PostCSS -> `vendor/web` | Reuse Tailwind/build dependencies | Desktop-owned Vite build | Removed |
| `prepare:web-shared` | Install `vendor/web/node_modules` | Root `npm ci` only | Removed |
| Local DeepSeek Agent | Historical Desktop AI | Cloud Agent client | Removed |
| Notes -> localhost `/api/notes` | Browser-compatible local transport | Tauri Notes command/application service | Migrated |
| Core state -> localhost `/api/state` | Browser-compatible local transport | Tauri state command/application service | Migrated |
| Analytics -> localhost | Existing projection service | Tauri analytics boundary | Migrated |
| Execution -> localhost | Large existing Axum route set | Tauri IPC + shared in-memory execution router | Migrated |
| Footprints -> localhost JSON | Main feature landed with HTTP API | Restricted local JSON IPC | Migrated |
| Photo Dashboard -> localhost JSON | Existing photo dashboard route | Restricted local JSON IPC | Migrated |
| Xunji multipart/JSON -> localhost | Browser-style image import | Raw Tauri IPC + restricted JSON IPC | Migrated |
| Photo media/LAN services | Binary streaming / device protocol | Purpose-built local services | Intentionally retained |

## WebView Search Results

### Remote LifeTrace Web URL

No authenticated Desktop core route navigates to a remote LifeTrace Web frontend.

Status: **pass**.

### iframe

No Desktop core feature is implemented by embedding a LifeTrace iframe.

Status: **pass**.

### Web Router / Web AppContext

The authenticated Desktop workspace is now Desktop-owned. `DesktopCloudWorkspace` uses native navigation, local state and `DesktopNativeRouteContent`; it no longer mounts Web AppContext, Web FeatureRouter or CloudDataStore.

Status: **removed**.

### Browser history / location

Browser primitives may still exist for ordinary WebView mechanics or browser/dev compatibility, but they are not the primary Desktop application router. Native Desktop navigation owns route history and last-route behavior.

Status: **migrated**.

## Current Desktop Route Ownership

`DesktopNativeRouteContent` owns the authenticated product pages, including:

- Today
- Execution
- Calendar
- Habits
- Fitness
- Health
- Review
- Notes
- Photos
- Footprints
- Finance
- Search
- Settings
- Cloud Agent

The current `main` Footprints feature was reconciled into the branch and connected to this native route. The legacy Travel PMTiles bridge was not restored.

## Desktop Platform Boundary

Platform capabilities are exposed through Desktop/Tauri services/adapters rather than directly from business UI.

Architecture guards reject regressions such as:

- feature UI importing low-level Tauri transport directly;
- Cloud Workspace invoking cloud commands directly;
- restoring the local Agent;
- routing Notes/Core state/Analytics/Execution back through packaged localhost JSON;
- widening the restricted local JSON command into an arbitrary `/api/*` proxy;
- reintroducing Desktop build dependencies on `vendor/web`.

Desktop startup also renders before the localhost compatibility health probe completes.

## Local Compatibility Server

The Axum localhost service is not a LifeTrace Web frontend. It is a native Rust compatibility surface.

Packaged Desktop JSON/data paths now use IPC:

- Notes: Tauri command.
- Core local state: Tauri command.
- Analytics/Search: Tauri command.
- Execution: `execution_api_request` + shared in-memory router.
- Footprints: restricted local JSON IPC.
- Photo Dashboard: restricted local JSON IPC.
- Xunji confirm/cancel: restricted local JSON IPC.
- Xunji image parse: raw Tauri IPC.

Browser/dev may continue using the HTTP adapters.

The intentionally retained local network services are different in kind:

- photo media on `127.0.0.1:3444` provides addressable image/video bytes to renderer media elements;
- LAN photo pairing/upload provides a device protocol.

These are not Web frontend dependencies and are not JSON business-data fallback paths.

## Build-time Web Snapshot Dependencies

Desktop build-time dependency on `vendor/web` is removed.

The Desktop no longer:

1. loads Web global CSS;
2. compiles `vendor/web/src`;
3. points Vite PostCSS at `vendor/web`;
4. aliases MapLibre/PMTiles to `vendor/web/node_modules`;
5. installs `vendor/web` dependencies with `prepare:web-shared`;
6. runs `ensure-shared-web-deps.mjs` in dev/lint/build/CI/release.

The checked-in `vendor/web` tree can remain as repository history/reference without being a Desktop runtime/build dependency. Genuine shared protocol code under `vendor/shared` remains.

Status: **pass**.

## Acceptance Test

Repository CI validates:

```text
npm ci
npm run lint
npm run test:unit
npm run web:build
npm run test:rust
```

Desktop CI #278 passed both Linux frontend-static and Windows frontend-and-rust jobs on implementation commit `8453fab`.

For manual product validation:

1. Do not run the LifeTrace Web frontend.
2. Keep LifeTrace Cloud/Backend available for cloud-only features.
3. Start Tauri Desktop.
4. Validate native login/session restore and offline authenticated workspace.
5. Validate SQLite-backed Dashboard/Habits/Finance/Review/Fitness.
6. Validate Notes create/edit/save/restart.
7. Validate Execution, Footprints and Search.
8. Validate Photo Dashboard/media/Vault/attachments.
9. Validate Xunji import.
10. Validate Sync.
11. Validate Cloud Agent failure isolation.

Expected result: Desktop core product remains usable without the LifeTrace Web frontend.

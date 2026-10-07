# Desktop Native Refactor Plan

## Scope

This plan covers the LifeTrace Desktop architecture refactor on `refactor/desktop-native-cloud-agent`: Desktop-owned presentation, local-first data access, cloud transport, sync boundaries, Notes, Search, Execution, Photos, imports and the cloud-only Agent.

The legacy Travel / 旅行足迹 implementation is not restored by this refactor. During branch reconciliation, the current `main` Footprints feature was merged and wired into the native Desktop route without reintroducing the legacy Travel PMTiles/Web workspace architecture.

## Starting Point

Before the refactor, the application was already Tauri + React + Rust + SQLite, but the authenticated workspace reused a checked-in Web frontend runtime:

```text
Tauri React entry
  -> DesktopCloudWorkspace
  -> vendor/web AppContext + DesktopFeatureRouter + CloudDataStore
  -> Cloud API
```

A second local workspace used Desktop components through a localhost Axum API. That created two presentation/data paths, made login state determine which workspace was active, and left local-first features behind unnecessary HTTP hops.

The application did **not** embed the public LifeTrace website through an iframe or remote LifeTrace WebView URL. The coupling was source/build reuse of the Web frontend.

## Final Architecture

```text
Desktop React UI
       |
       v
Desktop services / stores
       |
       +-------------------------+
       |                         |
       v                         v
Tauri IPC                   Cloud transport
       |                         |
       v                         v
Rust application/router      Rust native HTTP
       |                         |
       v                         v
SQLite repositories          LifeTrace Cloud
       |                         |
       +---------- Sync ---------+
```

Rules:

1. Desktop feature pages are Desktop-owned and do not mount the LifeTrace Web router/pages.
2. SQLite-backed Desktop reads/writes use Tauri IPC as the primary packaged-app transport.
3. Browser/dev HTTP routes may remain compatibility adapters, but are not the packaged Desktop business-data path.
4. Cloud API requests go through the constrained Rust native transport.
5. Agent is cloud-only; no local model runtime or local model API key is part of the Desktop architecture.
6. Platform-specific file, media, secure credential, shell and Vault capabilities stay behind Desktop/Tauri boundaries.
7. The photo media/LAN servers are intentionally retained for addressable binary streaming and device protocols; they are not JSON business APIs.
8. `vendor/web` may remain checked into the repository as historical/reference source, but the Desktop runtime, typecheck, Vite build and CI bootstrap do not consume it.

## Migration Status

### Phase 1 — Architecture audit

Status: **complete**

- Confirmed Tauri 2 + React + TypeScript + Rust + SQLite/rusqlite + Zustand.
- Confirmed no remote LifeTrace page shell/iframe architecture.
- Identified Web runtime reuse, localhost JSON transport and local Agent runtime as the material boundaries to replace.

### Phase 2 — Native Desktop foundation

Status: **complete for this refactor scope**

Implemented:

- One authenticated Desktop workspace for online and offline identity states.
- Desktop-owned route state, history and page composition.
- Local-first SQLite state loading.
- Desktop adapters for sync, credentials, Notes files, storage, photos, Vault, shell URLs and app metadata.
- Shared `DesktopApiClient` / `AppError` cloud boundary.
- Architecture tests that prevent direct platform/network access from feature UI.
- Desktop rendering no longer waits for the localhost compatibility server.

### Phase 3 — Notes

Status: **complete**

Packaged Desktop path:

```text
NotesModule
 -> noteApi
 -> notes_query / notes_mutate
 -> commands::notes
 -> application::notes
 -> database::repositories::notes
 -> SQLite
 -> sync outbox/scheduler
```

Browser/dev `/api/notes` remains a thin compatibility adapter. Mutations wake the sync scheduler.

### Phase 4 — Core state, Search, Auth and Settings

Status: **complete**

- Dashboard/Habits/Finance/Review/Fitness local state uses `state_get/state_mutate`.
- Search/analytics uses `analytics_query -> application::analytics -> repository -> SQLite`.
- Auth uses native Rust HTTP plus secure refresh-token storage.
- Settings/Search are Desktop-owned pages; no Web settings/search page is mounted.

### Phase 5 — Execution and remaining local JSON transports

Status: **complete for the packaged Desktop data path**

Execution:

```text
Execution UI
 -> executionApi
 -> execution_api_request
 -> shared Axum execution router in-memory
 -> existing Rust execution domain/repositories
 -> SQLite
```

The same route definitions are reused by browser/dev HTTP compatibility, so the migration does not duplicate dozens of execution handlers.

Footprints and Photo Dashboard:

- `footprintApi` and Photo Dashboard use `localJsonRequest`.
- Tauri command `local_json_api_request` has an explicit allowlist for Footprints, Photo Dashboard and Xunji confirmation routes.
- It is not an arbitrary `/api/*` proxy.
- Successful mutations wake sync.

Xunji import:

- Packaged Desktop image parsing sends `Uint8Array` through raw Tauri IPC to `xunji_parse_image`.
- Rust reuses the same QR decode/share-page/import logic as the HTTP compatibility handler.
- Confirm/cancel uses the restricted local JSON IPC.
- Multipart HTTP remains only as browser/dev fallback.

Photos:

- Dashboard JSON is native IPC.
- `127.0.0.1:3444` media URLs and LAN photo services remain intentionally because images/video and device sync need addressable/streamable binary endpoints.

### Phase 6 — Local Agent removal / cloud Agent

Status: **complete**

Removed:

- Local DeepSeek UI/runtime.
- Local AI settings/API-key UI.
- Local assistant Axum routes.
- Local model calls and local Agent session runtime.

Desktop `/app/assistant` now uses `CloudAgentModule` and cloud Agent APIs through the constrained cloud transport.

Historical SQLite AI tables are not destructively dropped during this refactor.

### Phase 7 — Web frontend runtime and build removal

Status: **complete for Desktop**

Removed from the Desktop path:

- `vendor/web` AppContext, FeatureRouter and CloudDataStore runtime.
- Web global stylesheet dependency.
- `vendor/web/src` from Desktop typecheck.
- Vite PostCSS/Tailwind configuration sourced from `vendor/web`.
- Vite MapLibre/PMTiles aliases sourced from `vendor/web/node_modules`.
- `prepare:web-shared` lifecycle/CI/release bootstrap.
- `scripts/ensure-shared-web-deps.mjs`.

The Desktop build now installs only the root package dependencies. Shared contracts under `vendor/shared` remain because they are genuine shared protocol code, not Web page/runtime reuse.

### Phase 8 — Main reconciliation / Footprints

Status: **complete**

The branch was reconciled with `main` after the Footprints feature landed there.

- Current main Footprints data/migration/assets were retained.
- Footprints is owned by `DesktopNativeRouteContent`.
- Native shell/navigation exposes `/app/footprints`.
- The merge did not restore the old Web workspace or legacy Travel PMTiles bridge.
- Branch is no longer behind `main` at the closeout point.

### Phase 9 — Integration and regression validation

Status: **complete**

Repository validation commands are now:

```text
npm ci
npm run lint
npm run test:unit
npm run web:build
npm run test:rust
```

Desktop CI run #278 on implementation commit `8453fab` passed both jobs, including Windows lint, unit tests, Web build and Rust tests. The final documentation-only head must also remain green before merge.

## Module Status

| Module | Desktop-owned UI | Primary packaged transport | Web frontend runtime dependency | Status |
| --- | --- | --- | --- | --- |
| Startup / Shell | Yes | Tauri | No | Migrated |
| Auth | Yes | Rust native HTTP | No | Migrated |
| Dashboard / Habits / Finance / Review / Fitness | Yes | Tauri core-state commands | No | Migrated |
| Notes | Yes | Tauri Notes commands | No | Migrated |
| Search / Analytics | Yes | Tauri analytics command | No | Migrated |
| Settings | Yes | Desktop services/adapters | No | Migrated |
| Execution | Yes | Tauri IPC + shared in-memory router | No | Migrated |
| Footprints | Yes | Restricted local JSON IPC | No | Native route integrated |
| Photo Dashboard | Yes | Restricted local JSON IPC | No | Migrated |
| Photo media / LAN sync | Yes | Purpose-built local binary/network service | No | Intentionally retained |
| Xunji import | Yes | Raw Tauri IPC + restricted JSON IPC | No | Migrated |
| Vault / local files | Yes | Desktop/Tauri adapters | No | Migrated |
| Agent | Yes | Cloud API via Rust transport | No | Cloud-only |

## Residual Boundaries

The following are intentional, not incomplete Web migration work:

- Browser/dev compatibility HTTP routes for testing and non-Tauri development.
- Local photo media streaming and LAN pairing/device services.
- Checked-in `vendor/web` reference source that is no longer consumed by the Desktop runtime/build.
- Historical unused local Agent database tables, pending a separately approved destructive data-migration policy.

## Acceptance Criteria

- [x] Desktop authenticated workspace does not mount the LifeTrace Web router/pages.
- [x] Desktop core UI is Desktop-owned React.
- [x] Core local state is loaded from SQLite through Desktop/Tauri boundaries.
- [x] Notes use Desktop UI and direct Tauri application-service commands.
- [x] Notes autosave remains local-first.
- [x] Auth does not require the LifeTrace Web frontend.
- [x] Search and Settings are Desktop-owned pages.
- [x] Local Agent runtime is removed.
- [x] Agent UI uses Cloud Agent APIs.
- [x] Cloud Agent failure cannot block Desktop startup.
- [x] Common cloud requests have an API client and AppError model.
- [x] Execution and remaining packaged Desktop JSON feature transports no longer depend on localhost HTTP.
- [x] Xunji image import uses raw Tauri IPC in the packaged Desktop app.
- [x] Build-only `vendor/web` dependency/bootstrap is removed from Desktop.
- [x] Current main Footprints feature is integrated without restoring the legacy Web workspace.
- [x] Implementation CI gates are green; final head is required to stay green before merge.

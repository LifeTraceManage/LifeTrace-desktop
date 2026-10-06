# Desktop Native Refactor Plan

## Scope

This plan covers the non-Travel architecture of LifeTrace Desktop.

Travel / 旅行足迹 is explicitly excluded from this refactor. Travel code, tests, documents, routes, data models, map dependencies and feature-specific integrations must not be modified by this workstream.

## Current Architecture

The repository is a Tauri 2 desktop application using React 19, TypeScript, Rust, SQLite/rusqlite and Zustand.

Before this refactor, the authenticated desktop workspace reused a checked-in Web frontend feature snapshot under `vendor/web`:

```text
Tauri React entry
  -> DesktopCloudWorkspace
  -> vendor/web AppContext + DesktopFeatureRouter + CloudDataStore
  -> Cloud API
```

At the same time, a second local workspace used Desktop-owned components and SQLite data:

```text
HengXuShell
  -> Desktop feature components
  -> /api/* localhost compatibility server
  -> Rust repositories
  -> SQLite
```

This created two presentation stacks and made login state decide which UI/data path was active.

The repository did not embed the public LifeTrace website through iframe or a remote application URL. The material dependency was source-level reuse of the Web frontend runtime and router.

## Target Architecture

```text
Presentation (Desktop React)
        |
Feature / Store
        |
Desktop Service / Application Boundary
        |
+---------------------------+
|                           |
Local Repository            Cloud API Client
|                           |
Tauri Command               Rust native HTTP transport
|                           |
Rust Application Service    LifeTrace Backend
|                           |
Repository / SQLite         Auth / Sync / Agent
        \                   /
         ------ Sync -------
```

Rules:

1. Desktop feature components do not depend on LifeTrace Web pages or Web router state.
2. Local-first domain reads/writes prefer SQLite through Tauri commands.
3. Browser/dev HTTP routes may remain as compatibility adapters but do not own business rules.
4. Rust application services orchestrate use cases; repositories own SQLite persistence.
5. Cloud business clients use a common API client and `AppError` model.
6. Authentication remains native; refresh credentials use platform secure storage.
7. The Desktop Agent is a cloud client only. No local model/Agent runtime is started or configured.
8. Platform-specific file/shell/media operations are kept behind Desktop/Tauri adapters.
9. Travel interfaces remain compatible and untouched.

## Migration Strategy

### Phase 1 — Architecture audit

Status: **complete**

- Confirmed React + TypeScript + Tauri + Rust + SQLite + Zustand.
- Audited bootstrap, local Axum server, auth, sync, Notes, photos, settings and Agent.
- Confirmed there is no remote LifeTrace Web iframe/WebView page shell.
- Identified `vendor/web` runtime/router reuse as the principal Web frontend coupling.

### Phase 2 — Desktop foundation

Status: **substantially complete**

Implemented:

- Native authenticated workspace routing.
- Native in-app navigation history.
- Local-first SQLite state loading.
- Tauri command boundaries for core local state.
- Shared Rust application service boundaries.
- Unified cloud `DesktopApiClient`.
- Unified `AppError`.
- Native Rust cloud transport remains the network authority.
- Architecture guard tests.

Still transitional:

- Some existing Desktop services (notably execution/analytics/import compatibility paths) still use the local Axum API rather than direct Tauri commands.
- Vite still references shared build tooling/dependencies under `vendor/web`; this is build-time reuse, not Web page/runtime reuse. Travel compatibility constraints prevent indiscriminate dependency cleanup.

### Phase 3 — Notes migration

Status: **complete for the Desktop data path**

Current path:

```text
NotesModule
 -> noteApi
 -> notes_query / notes_mutate
 -> Rust commands::notes
 -> application::notes
 -> database::repositories::notes
 -> SQLite
 -> sync outbox/scheduler
```

Implemented:

- List/Get/Create/Update/Delete.
- Search/sort through repository contract.
- Folders/tags.
- Favorite/pin/archive/trash/restore.
- Revisions.
- Attachments.
- Existing debounced autosave and explicit save state.
- Browser/dev HTTP route retained only as an application-service adapter.
- SQLite work moved to blocking worker threads.
- Mutations wake the sync scheduler.

### Phase 4 — Auth / Search / Settings

Status: **mostly complete**

Auth:
- Native Desktop login/register/session UI.
- Native Rust auth HTTP client.
- Windows Credential Manager refresh-token storage.
- No LifeTrace Web login page dependency.

Search:
- Desktop-owned search page.
- Local SQLite analytics/search index is the data source.
- The analytics transport remains on the local HTTP compatibility layer and is a remaining cleanup target.

Settings:
- Desktop-owned settings UI.
- Account/about/backup/local tools remain Desktop components.
- No Web Settings page is mounted.

### Phase 5 — Photos / Attachments

Status: **functional; adapter cleanup remains**

- Photo sync and local Vault are Desktop-native/Tauri capabilities.
- Notes attachments use Desktop file picker and native commands.
- Shared filesystem/photo infrastructure is retained to avoid breaking Travel.
- Further work should consolidate remaining `window.*Api` access behind typed service adapters without changing Travel callers.

### Phase 6 — Local Agent runtime removal

Status: **complete**

Removed:

- Local DeepSeek Agent UI/runtime.
- Local AI settings/API-key UI.
- Local assistant Axum routes.
- Local assistant conversation/settings implementation.

Retained:

- Desktop Agent page, now backed only by LifeTrace Cloud Agent APIs.
- Cloud session/message/approval workflow.

Historical SQLite tables are not destructively dropped during this refactor.

### Phase 7 — Remaining Web frontend removal

Status: **runtime migration complete; build-time cleanup partial**

- Authenticated Desktop workspace no longer mounts `vendor/web` AppContext, router, CloudDataStore or Web feature pages.
- Tauri React entry no longer loads Web frontend global styles.
- Desktop TypeScript configuration no longer compiles `vendor/web/src` page sources.
- Remaining `vendor/web` references in build configuration/shared dependencies require a separate compatibility-safe cleanup because some dependencies overlap Travel work.

### Phase 8 — Dead code / permissions / compatibility cleanup

Status: **partial**

Remaining candidates:

- Convert analytics/execution local HTTP adapters to Tauri application commands where useful.
- Consolidate Desktop file/photo attachment bridges behind typed service APIs.
- Reassess Axum modules after all feature transports are native commands.
- Remove build-only Web tooling only after confirming no Travel/shared dependency impact.
- Audit CSP/local ports after compatibility server usage is reduced.

### Phase 9 — Integration / regression / build

Status: **in progress**

Required CI commands are the repository's real commands:

```text
npm ci
npm run prepare:web-shared
npm run lint
npm run test:unit
npm run web:build
npm run test:rust
```

No tests should be deleted to hide failures. Travel-related failures, if introduced by parallel Travel work, must be reported instead of patched from this branch.

## Module Status

| Module | Desktop-owned UI | Local-first | Native transport boundary | Web frontend runtime dependency | Status |
| --- | --- | --- | --- | --- | --- |
| Startup / Shell | Yes | Yes | Tauri | No | Migrated |
| Auth | Yes | Session-aware | Rust native HTTP | No | Migrated |
| Dashboard / Habits / Finance / Review / Fitness | Yes | Yes | Tauri core-state commands | No | Migrated |
| Notes | Yes | Yes | Tauri Notes commands | No | Migrated |
| Search | Yes | Yes | Local HTTP analytics adapter | No | Functional / transport cleanup remains |
| Settings | Yes | Yes | Desktop services | No | Migrated |
| Photos / Vault | Yes | Yes | Existing Tauri/Desktop APIs | No | Functional |
| Execution | Yes | Yes/SQLite-backed | Local HTTP compatibility API | No | Functional / transport cleanup remains |
| Agent | Yes | Cloud-only | DesktopApiClient + Rust cloud transport | No | Migrated |
| Travel | Excluded | Excluded | Excluded | Excluded | Not modified |

## Risks

- Sync DTO/schema drift between the shared contracts and legacy local DTOs.
- Migrating every localhost endpoint in one change would create unnecessary regression risk; adapters should be replaced module-by-module.
- Removing shared build dependencies can break Travel or other shared modules; dependency cleanup must follow reference checks.
- Historical local Agent tables may remain unused until a separately approved data-migration policy exists.
- Native navigation must preserve expected back/forward and last-route behavior without browser router assumptions.

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
- [ ] Remaining local HTTP feature transports are fully converted to Tauri commands.
- [ ] Build-only `vendor/web` tooling is removed after Travel/shared dependency validation.
- [ ] All current CI jobs are green on the refactor branch.
- [x] Travel feature files are not intentionally modified by this refactor.

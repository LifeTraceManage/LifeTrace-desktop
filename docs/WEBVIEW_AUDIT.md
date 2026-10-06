# WebView / Web Frontend Dependency Audit

## Summary

LifeTrace Desktop is a Tauri application, so its React UI is rendered in the operating system WebView provided by Tauri. That runtime WebView is expected and is not the problem addressed here.

The audit found **no non-Travel architecture where Desktop loads the public LifeTrace Web application through an iframe, remote WebView URL, or remote LifeTrace page shell**.

The problematic dependency was instead compile-time/source-level reuse of the checked-in Web frontend implementation under `vendor/web`.

## Audit Classification

| Current dependency | Reason it existed | Target implementation | Migration status |
| --- | --- | --- | --- |
| `DesktopCloudWorkspace -> vendor/web AppContext` | Reuse Web application state container | Desktop local-first state + native services | Removed |
| `DesktopCloudWorkspace -> DesktopFeatureRouter` | Reuse Web routes/pages after login | Desktop-owned route state and native page composition | Removed |
| `DesktopCloudWorkspace -> CloudDataStore` | Make cloud state the authenticated UI source of truth | SQLite is UI source of truth; Sync coordinates cloud | Removed |
| Tauri entry -> Web global styles | Reuse Web visual contract | Desktop CSS/tokens only | Removed |
| Desktop TypeScript -> `vendor/web/src/**/*.tsx` | Compile reused Web pages | Compile Desktop sources only | Removed |
| Local DeepSeek Agent runtime | Historical Desktop AI implementation | Cloud Agent client | Removed |
| Notes -> localhost `/api/notes` | Browser-compatible transport reused on Desktop | Tauri Notes command -> application service -> repository | Migrated |
| Core local state -> localhost `/api/state` | Browser-compatible local server | Tauri state command -> application service -> repository | Migrated |
| Analytics/Search -> localhost API | Existing local projection service | Tauri analytics application boundary | Migrated; HTTP kept for browser/dev |
| Execution -> localhost API | Existing local execution service | Tauri execution application boundary | Pending cleanup |
| Vite/PostCSS/shared dependency references to `vendor/web` | Shared build/dependency setup | Desktop-owned build tooling where safe | Partial; preserve Travel compatibility |

## WebView Search Results

### Remote LifeTrace Web URL

No authenticated Desktop core route requires navigating to a remote LifeTrace Web frontend.

Target: remain absent.

Status: **pass**.

### iframe

No Desktop core feature is implemented by embedding a LifeTrace iframe.

Target: remain absent.

Status: **pass**.

### Web Router

Before refactor, authenticated Desktop used `vendor/web/src/app/DesktopFeatureRouter.tsx`.

Target: Desktop route state owned by the Desktop application.

Status: **removed from the authenticated runtime**.

### window.location / browser history

Browser navigation is not used as the primary Desktop application router. Native Desktop navigation now keeps its own atomic history and last route. Online and offline authenticated states use this same workspace.

Normal page reload/error recovery code may still use browser primitives because Tauri's React renderer is a WebView; this is not a dependency on the LifeTrace Web frontend.

Status: **core routing migrated**. Login/logout no longer require a full page reload to switch workspaces.

### Web-only runtime

Before refactor, authenticated pages required Web AppContext/CloudDataStore and Web feature modules.

Target: Desktop pages use Desktop stores/services/repositories.

Status: **runtime dependency removed for the primary non-Travel workspace**.

## Current Desktop Route Ownership

The authenticated workspace is composed by `DesktopNativeRouteContent` and Desktop-owned modules for:

- Today
- Execution
- Calendar
- Habits
- Fitness
- Health
- Review
- Notes
- Photos
- Finance
- Search
- Settings
- Cloud Agent

Travel is intentionally omitted from this audit's migration work and is not changed.

## Desktop Adapter Boundary

Non-Travel React components are now guarded from direct platform access. Native capabilities are exposed through `src/desktop` adapters for sync, secure credentials, Notes files, storage, photo sync, Vault, external URLs and app metadata.

Component tests fail if non-Travel React UI imports Tauri APIs, calls `invoke()` or `fetch()`, or accesses a `window.*Api` bridge directly.

The Tauri UI also renders before the localhost compatibility server health check completes; that server is no longer a prerequisite for core Desktop startup.

## Local Compatibility Server

The Axum service on localhost is not a LifeTrace Web frontend. It is a native Rust compatibility/API process running inside the Desktop application.

Current status:

- Notes: Desktop no longer depends on its HTTP route.
- Core local state: Desktop no longer depends on its HTTP route.
- Analytics/search: Desktop uses Tauri IPC; HTTP route is browser/dev compatibility only.
- Execution and selected import/photo features still use compatibility routes where their existing local service behavior remains useful.

Therefore, removing the Web frontend and removing localhost compatibility transport are separate concerns. The former is addressed; the latter is an incremental native-IPC cleanup.

## Build-time Web Snapshot Dependencies

The Desktop runtime no longer mounts Web pages, but some build configuration still uses files/dependencies located under `vendor/web`.

These references should not be deleted blindly because the repository contains shared and Travel-related dependencies. This workstream must not modify Travel dependencies without a reference-safe migration.

Target:

1. Move non-Travel build config needed by Desktop into Desktop-owned locations.
2. Keep shared packages where truly shared.
3. Remove `vendor/web` build references only after confirming Travel/shared consumers.

Status: **partial**.

## Acceptance Test

To validate removal of the actual Web frontend dependency:

1. Do not run the LifeTrace Web frontend.
2. Keep LifeTrace Backend/Cloud available.
3. Start the Tauri Desktop app.
4. Validate startup and native login.
5. Validate local SQLite Dashboard/Habits/Finance/Review/Fitness.
6. Validate Notes create/edit/save/restart path.
7. Validate Photos/attachments/local tools.
8. Validate local Search/Settings.
9. Validate Sync against Backend.
10. Validate Cloud Agent separately; Agent failure must not break other pages.

Expected: the Desktop core remains usable without the LifeTrace Web frontend.

# LifeTrace Desktop 架构重构审计与实现说明

> 分支：`refactor/desktop-native-cloud-agent`  
> 范围：桌面端架构、数据访问、同步、Notes、Execution、照片/导入、Agent、Web 前端边界。  
> 说明：旧 Travel / 旅行足迹实现不在本轮恢复范围；同步 `main` 时接入了当前 Footprints 功能，并保持 native Desktop 路由。

## 1. 重构前的问题

LifeTrace Desktop 本来就是 Tauri + React + Rust + SQLite，并没有通过 iframe 或远程 WebView URL 把线上 LifeTrace Web 整站嵌进桌面端。

真正的问题是源码、构建和本机传输边界混在一起：

- 登录后的工作台直接复用 `vendor/web` 的 AppContext、FeatureRouter 和 CloudDataStore。
- Tauri 入口/Vite 构建依赖 `vendor/web` 的样式、PostCSS/Tailwind 和 node_modules。
- 在线与离线身份状态会进入不同工作台。
- Notes、Execution、照片 Dashboard、导入等本地能力复用了 localhost JSON API。
- React 页面中存在直接 Tauri/网络桥接。
- Desktop 内还运行完整的本地 DeepSeek Agent，并保存本地模型配置。

## 2. 最终架构

```text
React Desktop UI
        |
        v
Desktop services / stores
        |
        +---------------------------+
        |                           |
        v                           v
Tauri IPC                       Cloud transport
        |                           |
        v                           v
Rust application/shared router  Rust cloud_api/native auth
        |                           |
        v                           v
Repository / SQLite             LifeTrace Cloud
        |                           |
        +------------ Sync ---------+
```

约束：

1. React 业务组件不直接操作 SQLite。
2. React 业务组件不直接拼接任意云地址或直接调用底层 Tauri transport。
3. 本地 SQLite 业务数据在 packaged Desktop 中优先走 Tauri IPC。
4. 浏览器/dev HTTP route 仅作为兼容 adapter，不是 packaged Desktop 主路径。
5. Cloud API 通过 Rust 原生 HTTP transport，并限制到配置 origin 与受控 API namespace。
6. Agent 只使用云端 Agent；Desktop 不运行本地模型、不保存本地模型 API Key。
7. 照片媒体流/LAN 设备协议是有意保留的本地网络能力，不与 JSON 业务 API 混为一类。
8. Desktop runtime、typecheck、Vite、CI 不再消费 `vendor/web`。

## 3. 已完成的重构

### 3.1 原生 Desktop 工作台

`DesktopCloudWorkspace` 不再挂载 Web AppContext/FeatureRouter/CloudDataStore，而是使用：

- `DesktopWorkbenchShell`
- `DesktopNativeRouteContent`
- `useDesktopNavigation`
- `useLifeStore`
- `src/desktop/*Adapter.ts`

在线与离线已认证状态使用同一个 native Desktop workspace。Desktop UI 会先渲染，再异步探测兼容服务，因此 localhost 兼容服务失败不会阻塞核心启动。

### 3.2 Cloud transport

`src/services/cloudTransport.ts` 统一云请求边界：

- 仅允许受控 LifeTrace Cloud API 路径；
- 统一路径兼容映射；
- 限制 JSON 请求体；
- 401 refresh + retry；
- 最终通过 Rust `cloud_api_http_request` 发起原生 HTTP。

Cloud Agent、Mail 等 `/api/v1/*` 是云 API，不经过本机 localhost JSON 服务。

### 3.3 本地 Agent 删除，云 Agent 接管

删除：

- `src/components/AIAssistantModule.tsx`
- `src/components/AISettingsPanel.tsx`
- `src-tauri/src/server/assistant.rs`
- 本地 AI 设置/API Key 运行时
- 本地 assistant route 和 DeepSeek 调用

`/app/assistant` 现在由 `CloudAgentModule` 接管，支持云端会话、消息、删除、pending approval、approve/reject 与 provider 展示。

### 3.4 Notes / Core state / Analytics

Notes packaged Desktop：

```text
NotesModule
 -> noteApi
 -> notes_query / notes_mutate
 -> application::notes
 -> notes repository
 -> SQLite
```

Core local state：

```text
useLifeStore
 -> sqliteClient
 -> state_get / state_mutate
 -> application::state
 -> domain repositories
 -> SQLite
```

Search/Analytics：

```text
DesktopSearchModule
 -> analyticsApi
 -> analytics_query
 -> application::analytics
 -> analytics repository
 -> SQLite
```

写操作会唤醒 sync scheduler；browser/dev HTTP handlers 仅保留兼容 adapter。

### 3.5 Execution

Execution endpoint 面很大，直接把几十个 handler 复制成 command 会形成第二套业务路由。因此本轮采用共享 router：

```text
Execution UI
 -> executionApi
 -> execution_api_request
 -> execution_routes() in-memory Axum Router
 -> existing execution handlers/domain
 -> SQLite
```

HTTP compatibility server 同样 `.merge(execution_routes())`，所以业务路由定义只有一份。IPC 只允许 `/api/execution/*` 和受控 HTTP method，成功 mutation 会唤醒 sync。

### 3.6 Footprints、Photo Dashboard 与受限 local JSON IPC

新增 `src/services/localJsonTransport.ts` 与 `commands::local_api::local_json_api_request`。

allowlist 仅覆盖：

- `/api/footprints/*`
- `/api/photo-sync/dashboard`
- `/api/xunji/imports`

它不是任意 `/api/*` 代理。

Footprints 已接入 `DesktopNativeRouteContent` 的 `/app/footprints`，与当前 `main` 的数据模型、迁移、地图数据和 UI 保持一致，同时不恢复旧 Travel PMTiles bridge。

### 3.7 Xunji 导入

Packaged Desktop：

- 图片通过 `Uint8Array` raw Tauri IPC 调用 `xunji_parse_image`；
- Rust 复用 `decode_qr -> fetch_page -> parse_page -> save import`；
- confirm/cancel 通过 restricted JSON IPC；
- browser/dev 仍可使用 multipart HTTP adapter。

这避免了大图片经 localhost multipart 绕行，也没有复制解析业务逻辑。

### 3.8 Photos / Vault / 文件

- Photo Dashboard JSON 已改为 IPC。
- Notes 附件、Storage、Vault、Photo sync 控制面通过 Desktop/Tauri adapters。
- `127.0.0.1:3444` media URL 与 LAN photo service 保留，用于 `<img>/<video>` 可寻址二进制流和设备同步协议。
- 这部分不是 Web 前端依赖，也不是待迁的 JSON CRUD transport。

### 3.9 `vendor/web` 构建依赖移除

Desktop 已不再：

- import `vendor/web` runtime/page source；
- typecheck `vendor/web/src`；
- 从 `vendor/web/postcss.config.cjs` 获取 PostCSS/Tailwind；
- 从 `vendor/web/node_modules` alias MapLibre/PMTiles；
- 运行 `prepare:web-shared`；
- 使用 `scripts/ensure-shared-web-deps.mjs`。

`vendor/shared/contracts` 仍保留，因为它是共享协议代码，而不是 Web 页面/runtime。

## 4. 数据归属

### Local only

- SQLite 数据库与本地缓存
- 本地附件实际文件
- Vault / 私密相册
- 本地导入文件
- 本机存储位置
- 明确不跨设备同步的 UI 偏好

### Cloud / Sync

- 账号、认证与设备会话
- 同步协议实体
- Notes / habits / finance / workout / execution 等同步实体
- 云端 Agent 会话、消息、审批与执行

### Secret local only

- refresh token：Windows Credential Manager
- Vault 密钥/口令派生材料

本地 DeepSeek API Key 已从运行时架构移除。

## 5. 同步原则

所有绕过 localhost HTTP 的本地 mutation 都必须保持同步唤醒语义：

1. UI/service 发起 Tauri IPC。
2. Rust command/application/shared router 更新 SQLite。
3. repository/trigger 记录 sync outbox。
4. command 在成功 mutation 后调用 `SyncDesktopState::signal_local_change()`。
5. sync scheduler push/pull 并更新 cursor/version/conflict state。

## 6. 架构守卫

测试会约束：

- 本地 Agent 文件/route 不得恢复。
- Notes/Core state/Analytics 使用 native command/application boundary。
- Execution 使用受限 IPC + shared router。
- Footprints/Photo Dashboard/Xunji confirmation 使用受限 local JSON IPC。
- Xunji 图片在 Tauri 走 raw IPC。
- React Cloud Workspace 不得直接调用底层 invoke/network transport。
- Desktop native route 必须持有核心页面与 CloudAgentModule/Footprints。
- Desktop build/workflow 不得恢复 `prepare:web-shared` 或 `vendor/web` Vite dependency。
- `local_json_api_request` 不得退化为任意 `/api/*` 代理。

## 7. 保留的兼容边界

以下内容是有意保留，而不是半成品：

- browser/dev HTTP compatibility routes；
- 照片媒体 `127.0.0.1:3444` 流式服务；
- LAN photo pairing/upload protocol；
- 仓库中的 `vendor/web` snapshot/reference（Desktop 不再依赖它）；
- 历史 AI SQLite 表（未批准破坏性迁移前不主动 DROP）。

## 8. 验收

当前仓库 CI 的真实命令：

```text
npm ci
npm run lint
npm run test:unit
npm run web:build
npm run test:rust
```

Desktop CI #278 在实现提交 `8453fab` 上已通过：

- Linux frontend-static：npm ci / lint / unit 全绿；
- Windows frontend-and-rust：npm ci / lint / unit / web build / Rust tests 全绿。

文档收口后的最终 HEAD 仍必须通过同一套 CI 后才可视为可合并。

## 9. Main / Footprints 同步确认

本分支已把 `main` 的 Footprints 提交以真实 merge commit 合入，解决了 PR merge conflict；接入方式保持 native Desktop 路由，并没有恢复旧 Web workspace 或 legacy Travel PMTiles bridge。

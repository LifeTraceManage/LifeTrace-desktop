# LifeTrace Desktop 架构重构审计与实现说明

> 范围：桌面端架构、数据访问、同步、Notes、Agent、Web 兼容边界。  
> 明确排除：Travel / 旅行足迹相关文件、路由、组件、服务、数据结构与配置。

## 1. 重构前审计结论

当前桌面端已经是 Tauri + React + Rust + SQLite 应用，并不存在把线上站点通过 iframe 或远程 WebView URL 整体嵌入桌面的实现；真正的问题是**源码级 Web 应用耦合**：

- Tauri UI 入口直接加载 `vendor/web/src/styles/globals.css`。
- `DesktopCloudWorkspace` 直接引用 `vendor/web` 的 AppContext、FeatureRouter、AgentSidebarContext 与 CloudDataStore。
- Vite 构建继续依赖 `vendor/web` 的 PostCSS/Tailwind 与部分前端依赖。
- 登录后的工作台状态由 Web CloudDataStore 驱动，本机同步副本更多作为后台副本使用；离线时则切换到另一套 HengXuShell，本质上形成两套工作台。
- Notes 桌面 UI 通过 `fetch("/api/notes")` -> localhost:3103 -> Axum handler -> Repository -> SQLite，存在不必要的本机 HTTP 跳转。
- 本地还存在完整 DeepSeek AI 管家：本机 API Key、会话表、Axum assistant 路由、DeepSeek HTTP 调用与独立 UI；这与“云端 Agent 为唯一 Agent”的目标冲突。
- React 页面中存在直接 Tauri `invoke` 网络桥接逻辑，UI、传输与应用层边界不清晰。

## 2. 本轮目标架构

```text
React Desktop UI
        |
        v
Desktop Service / Application Boundary
        |
        +--------------------------+
        |                          |
        v                          v
Tauri Commands                 Cloud Transport
        |                          |
        v                          v
Rust Application Service       Rust cloud_api command
        |                          |
        v                          v
Repository / SQLite            LifeTrace Cloud API
        |                          |
        +-----------> Sync <-------+
```

规则：

1. React 组件不直接操作 SQLite。
2. React 组件不直接拼接任意云地址。
3. Tauri command 只负责 transport 参数和状态转发。
4. Rust application service 负责用例编排。
5. Repository 负责 SQLite 持久化。
6. 云 API 由 Rust 原生 HTTP transport 发起，并限制在配置的 origin 与 `/api/v1/`。
7. Agent 只使用云端 Agent API；桌面端不运行本地模型、不保存本地模型 API Key。
8. `vendor/web` 仅允许通过 `src/compat` 过渡性访问，避免业务组件继续产生新的直接依赖。

## 3. 已实现的重构

### 3.1 Web 兼容边界

新增：

- `src/compat/webWorkspace.tsx`
- `src/compat/webWorkspaceStyles.ts`

`DesktopCloudWorkspace` 和 Tauri UI 入口不再直接导入 `vendor/web`。剩余共享 Web 页面仍可工作，但依赖集中到一个可替换边界。

这一步的目的不是复制旧 Web 页面，而是先建立“只允许通过 compat 使用”的约束，为后续逐模块原生化提供稳定边界。

### 3.2 云 API transport 下沉

新增 `src/services/cloudTransport.ts`：

- React 页面不再直接调用 `invoke("cloud_api_http_request")`。
- transport 统一负责：
  - 仅允许 `/api/v1/`；
  - API 路径兼容映射；
  - JSON 请求限制；
  - 401 后 refresh + retry；
  - Tauri invoke 到 Rust 原生 HTTP client。

### 3.3 本地 Agent 删除

删除：

- `src/components/AIAssistantModule.tsx`
- `src/components/AISettingsPanel.tsx`
- `src-tauri/src/server/assistant.rs`

同时删除：

- HengXu 本地工作台的 AI 管家入口；
- 本地 AI 设置入口；
- `/api/assistant/*` 本地路由；
- `/api/settings/ai`；
- 本机 DeepSeek API Key 运行时；
- 本地 AI 会话运行时。

历史 SQLite 中若已有旧 AI 表，本轮不做破坏性 DROP；它们不再被创建、读取或写入，避免升级时无必要的数据破坏。

### 3.4 云端 Agent 成为桌面主 Agent

新增：

- `src/services/cloudAgentApi.ts`
- `src/components/CloudAgentModule.tsx`
- `app/cloud-agent.css`

桌面侧 `/app/assistant` 现在由原生桌面页面接管，不再依赖本地 Agent。支持：

- 云端 Agent 发问；
- 云端会话列表；
- 会话消息加载；
- 删除会话；
- pending approval 展示；
- approve / reject；
- 云端 provider 展示。

所有请求经 `cloudTransport` -> Rust -> LifeTrace Cloud。

### 3.5 Notes 改为 Tauri Command 主路径

新增：

- `src-tauri/src/application/notes.rs`
- `src-tauri/src/commands/notes.rs`

重构：

- `src/services/noteApi.ts`
- `src-tauri/src/server/notes.rs`

桌面运行时 Notes 主路径：

```text
NotesModule
  -> noteApi
  -> invoke(notes_query / notes_mutate)
  -> commands::notes
  -> application::notes
  -> database::repositories::notes
  -> SQLite
```

浏览器/dev 模式仍保留 `/api/notes`，但 Axum handler 已变成薄兼容 adapter，同样委托 `application::notes`，不再复制业务逻辑。

写操作成功后会调用 `SyncDesktopState::signal_local_change()`，保证绕过 localhost HTTP 后仍能及时唤醒同步调度器。

## 4. 数据归属

### Local only

- SQLite 数据库与本地缓存
- 本地附件实际文件
- 私密相册 / Vault
- 本地导入文件
- 本机存储位置
- 本机 UI 偏好中明确不要求跨设备同步的部分

### Cloud / Sync

- 账号、认证与设备会话
- 同步协议实体
- Notes / habits / finance / workout / execution 等可同步实体
- 云端 Agent 会话、消息、审批和 Agent 执行

### Secret local only

- refresh token：Windows Credential Manager
- Vault 密钥/口令派生材料
- 不允许业务 JSON / sync payload 携带 secret

本地 DeepSeek API Key 已从运行时架构中移除。

## 5. Notes 同步链路

本地编辑：

1. 编辑器调用 `noteApi.update`。
2. Desktop 使用 Tauri `notes_mutate`。
3. Application Service 调用 Notes Repository。
4. Repository 更新 SQLite。
5. 数据库 sync trigger/outbox 记录本地变化。
6. command 唤醒同步 scheduler。
7. sync client push 到云端。
8. server version / cursor 更新到本地 sync metadata。

云端变化：

1. sync client pull / snapshot。
2. Sync Store 设置 remote mutation context。
3. 远端 payload 通过 contract adapter 转成本地 DTO。
4. Repository 写入 SQLite。
5. 同设备已确认变更从 outbox 转为 confirmed。
6. 冲突进入 `sync_conflicts`，由现有冲突解析机制处理。

## 6. 架构守卫

新增/更新测试会约束：

- 本地 Agent 文件和路由不得恢复。
- Notes Desktop 必须优先使用 Tauri command。
- Notes HTTP handler 不得重新直接写 Repository 业务分支。
- React Cloud Workspace 不得直接 `invoke`。
- `vendor/web` 应用依赖必须经过 `src/compat`。
- 桌面 `/app/assistant` 必须指向 CloudAgentModule。

## 7. 当前过渡边界

仍保留的 `vendor/web` 内容是**编译期共享 feature snapshot**，不是远程网页容器。它目前用于尚未逐模块迁出的页面和 Tailwind 视觉契约。

新的桌面业务代码不得直接依赖这些路径；继续原生化时应逐模块替换 `src/compat` 暴露面，而不是复制 Web 页面到桌面目录。

## 8. 验收

需要通过仓库现有 CI：

```text
npm ci
npm run prepare:web-shared
npm run lint
npm run test:unit
npm run web:build
npm run test:rust
```

Windows CI 同时覆盖 Tauri/Rust 编译链和 Web build。所有失败必须在本分支修复后再合并。

## 9. Travel 隔离确认

本轮重构不修改 Travel 模块的业务文件、数据表、服务、地图、路由和文档。若仓库中存在历史 Travel 残留，它们不属于本次架构重构的修改范围。

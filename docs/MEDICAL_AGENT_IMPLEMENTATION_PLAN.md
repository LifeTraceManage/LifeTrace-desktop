# LifeTrace Desktop — Agent 医疗检查报告归档实施方案

> 状态：待开发（implementation plan，不代表代码已经实现）  
> 范围：`LifeTrace-desktop` + `LifeTrace-cloud` 两个仓库，现有云端 Agent 运行时  
> 产品原则：**只发报告 → 视觉模型直接理解 → 预览确认 → 本机普通文件归档 → Agent 可查询与更正**  
> 不做：独立 OCR、PaddleOCR/Docling/MinerU 流水线、完整 EMR/HIS、处方/疾病管理、基于影像作自动诊断。
> 需求来源：`docs/MEDICAL_ARCHIVE_PLAN.md`；本文件为工程执行、接口与验收的权威实施清单。

## 开发进展（2026-10-08，开发分支）

开发分支：`feature/agent-medical-report-archive`；两个仓库分别建立 Draft PR。**不代表 main 已合并或生产验证完成。**

已经实现的第一阶段代码：

- Desktop Agent 对话：JPG/PNG/WebP 多图选取与拖入、云端视觉识别请求、原图预览、结构化草稿和明确确认；识别有误可用自然语言说明再次调用视觉模型。
- Cloud：带鉴权的 `/api/v1/medical/extract`，原始图片以短期请求直接送到已配置的视觉模型；严格 JSON 草稿、源图 ID/报告日期/报告类型校验；不依赖独立 OCR。
- Desktop SQLite migration v22：医疗报告、结构化指标、源图和上传批次；原图保存在 `data_dir/medical/originals`，**不加密**。
- 相同用户下按源图 SHA-256 拒绝重复导入；禁止模型漏关联输入图片。模型临时图片 ID 入库时转换为可永久读取的本机附件 ID。
- 健康页面：检查记录列表、原文章节、指标表、源图查看、同名同单位历史数值趋势。
- migration v23：Agent 可以选取已存报告重新识别；确认后原记录更新，旧版结构化内容写入版本历史，原始图片保留不变。
- 已添加原始文件字节、数值、幂等提交、重复导入、遗漏页、证据 ID、修订版本等自动化测试。完整 CI 状态需以对应 PR 的最新 commit 检查为准。

仍**未实现或未完整验收**：

- PDF **已实现首版**：在 Desktop 使用 PDF.js 只渲染页面（不做 OCR/文字抽取），逐页发送视觉模型；入库的是未经修改的原始 PDF。当前每批最多 8 个视觉页面、PDF 单份 20 MiB，较长报告需分批导入，仍需 Windows 实测验收。
- 外部视觉模型真实医疗报告的端到端精度和完整性评估，以及任何生产模型适配验证。
- 已实现明文本地备份/恢复（完整原图 + 当前结构化结果 + 修订历史、SHA-256 校验及重复导入阻断）；仍需 Windows 实测。异常断电后的孤儿文件自动协调恢复、跨设备医疗专用同步尚未实现。
- 不重新发送图片的局部字段更正、删除、多个历史报告合并、跨图片语义去重。
- 现有泛用 Agent Rig 工具对本机医疗资料的直接查询：当前医疗识别通过 Agent UI 的专用视觉流程执行，不意味着泛用 Agent 已获得 SQLite 访问权限。

---

## 0. 决策与不可退让的约束

1. **Agent-first**：所有新增、修改、重新提取入口都由现有 Agent 对话触发；健康页面负责浏览和查询，不要求手工填写。
2. **原件不可变**：上传的 JPG/PNG/WebP/PDF 原始字节必须完整、长期、本机原样保存（不加密）（不因模型压缩图片而替换原件）；记录 SHA-256、格式、大小和上传顺序。
3. **仅直接视觉理解**：将图片直接交给支持视觉输入的多模态模型。PDF 若接口支持原生 PDF 则直接提交；否则按页渲染成图片提交模型，渲染不等于 OCR。不引入独立 OCR、版面引擎或文档文本抽取作为第二条处理链。
4. **完整性优先**：完整保留可识别的报告章节原文；再提取定量/定性/测量/分级等结构化结果。未识别字段设为 `null`/待核对，不擅自填日期、单位或结论。
5. **强类型、确定性落库**：LLM 只能产生 JSON 草稿；不能直接执行 SQL、访问本机文件、绕过审批或伪造成功回执。所有持久化经 Rust 校验、事务和幂等门禁。
6. **云端临时处理 / 本机长期归档**：报告图片经用户同意发送给 `LifeTrace-cloud` 及其实际配置的视觉模型提供商。云端仅保留短期处理材料，长期报告和结构化数据位于本机医疗报告文件夹与 SQLite（不加密）。
7. **不误导**：模型配置并非必然支持视觉输入，必须通过 provider capability check/实际探测验证；只在本机提交成功后显示“归档成功”。
8. **保持现有能力**：不能破坏健康概览、其他 Agent 会话、照片 Vault、Sync、笔记、足迹和现有数据库 migration；医疗实体默认完全排除普通 Sync/全局索引/Agent 长期记忆。
9. **医疗信息不是诊断**：保留医生报告本来的诊断或 TI-RADS 等等级，模型不能生成新的疾病诊断、处方或医疗决定。

## 1. 现状确认与差距

### 1.1 Desktop（已查仓库 main）

- `src/components/CloudAgentModule.tsx`：纯文本聊天、会话、审批，无文件选择/预览与结构化归档卡。
- `src/services/cloudAgentApi.ts`：`ask(prompt, sessionId)` 经 `/api/v1/web/assistant` 发 JSON 文本，不传图片。
- `src/components/DesktopHealthModule.tsx`：习惯/训练/复盘聚合，无检查记录。
- `src-tauri/src/database/migrations/mod.rs`：版本化 migration 最后已注册 v21；v18/19 被删除的 Travel 历史使用过，不可复用；建议添加 **v22**，落地前若版本已被占用则取下一未占用版本。
- `src-tauri/src/database/connection.rs`：普通 SQLite WAL，**并未对整库加密**。
- `src-tauri/src/vault/base.rs`：私密相册已有 Argon2id/AES-256-GCM、分块加密、完整性验证与锁定生命周期，本功能不复用其加密逻辑，使用独立普通文件夹，不破坏私密相册。

### 1.2 Cloud（已查仓库 main）

- `src/routes/assistant.rs`：`/api/v1/web/assistant` 与 `/api/v1/assistant` 使用文本 prompt；session/approval API 存在。
- `src/agent/`：Rig Agent、session、approval、tool/runtime 已存在。当前既有 approval 是**服务器端**批准和执行，无法直接写远程桌面 SQLite。
- `src/routes/mod.rs`：可扩展带身份鉴权的专用 medical 路由。
- `src/routes/files.rs` 是既有文件服务，但长期对象存储是可选配置，不能直接假定它具备医疗敏感文件的短时生命周期/专用访问隔离。

**必须做真实端到端改造**，而不是仅改提示词或将 JSON 写入聊天消息。

## 2. 目标使用流程

```text
Desktop Agent 输入框：上传 1..N 张图片 / PDF（可附文字）
  → 读取原始字节并保留在本次待确认会话中，生成 file_id、SHA-256
  → 首次告知传输到云端/视觉模型提供商，用户授权
  → Desktop 上传仅本批需要识别的临时处理副本到 Cloud
  → Cloud 校验格式/大小/会话权限，将图像交给多模态模型
  → 模型返回 JSON（可以是多报告/多检查）
  → Cloud 验证结构、证据关联，返回本次会话临时草稿
  → Desktop 将识别草稿暂存在当前页面内存中，等待确认
  → Agent 消息展示报告分组、指标行、结论、疑点和重复候选
  → 用户确认 / 对话纠错 / 取消
  → Desktop 调 Tauri medical_commit_draft（本机权限、事务、幂等）
  → 提交结果及数量显示；健康页可打开记录
  → Cloud 临时处理资产与医疗草稿清理
```

说明：**原始图片在用户确认后才写入本机磁盘**，识别或网络失败可在当前页面重新尝试，关闭页面前未确认的草稿不会永久保留。文档原件不能因为云端临时任务失败而丢失。

### 2.1 分组语义

- `import_batch` 是一次上传；`exam_event` 是一次体检/检查活动；`report` 是医院一份报告；`observation` 是报告内一条结果。
- 同一批照片可能覆盖一份报告的多页，也可能包含血液生化和彩超两份报告。
- 归组参考受检人标识的一致性、医院、时间、报告编号、页码与报告类型。受检人不一致时**阻断自动合并**并提示，不默默把两个人的数据混成一个档案。
- 时间分开存 `collection_at`（采样）、`exam_at`（检查）、`issued_at`（出报告）、`uploaded_at`；未知值为 null，不把“今天上传”冒充检查日期。
- 医疗实体属于当前 LifeTrace 用户/档案，不开放任意 user_id 自选或跨账号写入。

## 3. 通用报告数据模型（不按血检/彩超拆硬编码大表）

正式业务实体如下（这些是逻辑表名，落地由 Rust migration 实现）：

| 表 | 最小必备字段 | 关系/作用 |
| --- | --- | --- |
| `medical_exam_events` | id、owner_id、title、event_date_nullable、source_batch_id、created_at | 一次体检归档活动，可链接多份报告 |
| `medical_reports` | id、event_id、report_type、exam_at、collection_at、issued_at、facility、department、report_no、review_status、schema_version | 一份报告；可独立于 event 管理 |
| `medical_report_sections` | id、report_id、section_type、section_title_raw、content_raw、sequence、evidence_ref | 通用原文段落：所见、结论、建议、病理描述等 |
| `medical_observations` | id、report_id、name_raw、metric_key_nullable、kind、value_raw、value_num_nullable、comparator、unit_raw、ref_range_raw、source_flag、measured_at、evidence_ref | 数值、定性、计量、等级、文字结果等 |
| `medical_report_assets` | id、object_id、sha256、mime、bytes、original_name、uploaded_at | 原始普通文件索引；多个报告可引用同一份附件 |
| `medical_report_asset_links` | report_id、asset_id、page_range、sort_order | 多对多关联，避免同源照片重复复制 |
| `medical_evidence` | id、report_id、asset_id、page_index、source_quote、bbox_nullable、field_path、verification_state | 可追溯“这个值来自第几张/第几页” |
| `medical_import_jobs` | id、owner_id、session_ref_nullable、idempotency_key、state、encrypted_draft_ref、created_at、updated_at | 提取/审核/提交状态、可恢复重试 |
| `medical_report_revisions` | id、report_id、revision_no、encrypted_delta、source_action、created_at | 对话纠错、重新提取不覆盖旧版 |

**存储决策（2026-10-08 用户变更）**：MVP 不加密。原始图片按 UUID 文件名保存在 `data_dir/medical/originals/`，数据库 `lifetrace.db` 保存检查元数据、原文、结构化数值、SHA-256 和原始文件名（均为普通明文）。使用系统文件权限和 LifeTrace 当前登录档案隔离 UI 操作，但**无法防止具备本机文件系统权限的程序读取**。不依赖 Vault、SQLCipher、密码或解锁流程。

### 3.1 Observation 通用值结构

建议以以下版本化 DTO 保存（示例，字段可以为空）：

```json
{
  "schemaVersion": 1,
  "nameRaw": "丙氨酸氨基转移酶",
  "metricKey": "ALT",
  "kind": "numeric",
  "valueRaw": "89.0",
  "valueNumber": 89.0,
  "comparator": null,
  "unitRaw": "U/L",
  "referenceRangeRaw": "9-60",
  "referenceLow": 9,
  "referenceHigh": 60,
  "sourceFlag": "H",
  "evidence": {
    "assetId": "local-asset-id",
    "pageIndex": 0,
    "sourceQuote": "丙氨酸氨基转移酶 89.0 U/L"
  }
}
```

`kind` 支持 `numeric`、`qualitative`、`measurement`、`grade`、`text`、`range`；原报告“<0.5”必须同时保存 `valueRaw` 和比较符，不可仅保存 0.5。单位不一致或语义未能可靠匹配时不强行合并趋势。报告参考范围以当次来源为准。

### 3.2 彩超与影像

- `medical_report_sections` 完整保留原报告“检查所见”“超声提示/影像结论”文字，不只存 AI 摘要。
- 结节、器官尺寸、射血分数、TI-RADS 分级等可追加 `medical_observations`，每条带部位、左右侧、病灶描述和证据；不能根据“同在甲状腺”就擅自认定不同日期是同一个结节。
- 心电图、病理、胃镜和未来未预知的报告类型，都可通过 sections+observations 表达；无需每添加一个种类就先进行数据库 migration。

## 4. 视觉 Agent 解析契约

### 4.1 Provider 适配

- Cloud 在启动/调用时确定当前 `MODEL_PROVIDER`/`MODEL_NAME` 是否支持本次图片内容；若实际接口不支持，返回 `MODEL_VISION_UNAVAILABLE`，不能返回“识别完成”。
- Provider 适配器封装 `image/jpeg`、`image/png`、`image/webp` 的图片 part，PDF 原生或按页图像；转换只针对临时模型输入副本，不更改本机原件。
- 新模型接入只改 provider adapter 和能力配置，不变更存储结构。
- 不能单凭一个模型名称断言支持视觉；应结合所用 API、模型能力公告和集成测试校验。
- 推理输入/输出设置超时、上限和取消机制；模糊值标记未确认，不允许模型补全。
- **无独立 OCR fallback**；出现无法识别时提醒用户更清晰地拍照。

### 4.2 输出 DTO（`MedicalExtractionDraftV1`）

顶层：

```text
draftId, batchId, schemaVersion, reports[], groupingWarnings[],
duplicateCandidates[], requestedReviewFields[], createdAt
```

每份 report：

```text
title, reportType, examAt?, collectionAt?, issuedAt?,
facility?, department?, reportNo?, bodySite?,
sections[{kind,titleRaw,textRaw,evidence}],
observations[{kind,nameRaw,valueRaw,valueNumber?,unitRaw?,
 referenceRangeRaw?,sourceFlag?,bodySite?,laterality?,evidence}],
sourceAssetIds[], needsReview, reviewReasons[]
```

所有字段运行时严格校验：类型、长度、日期格式、附件 ID 归属、页码范围、文件数量、报告结构。预览前执行确定性质量门禁：是否某页未识别、报告可能截断、检验表明显漏行、重复候选、单位冲突。不要把模型自报 confidence 视为统计准确率。

### 4.3 Prompt 工程

分阶段生成、但**不使用 OCR**：

1. 第一次视觉调用：判断有几份报告、每份照片/页的归属、报告种类、可识别时间与标识。
2. 第二次视觉调用（按分组）：逐项完整提取原文章节/检验指标/测量值；按报告种类使用小而明确的 schema。
3. 程序校验/归一化：别名字典（借鉴 Soma 的 exact → alias → fuzzy → 有歧义则留待复核）、数据格式验证、去重候选。
4. Agent 对话展示：缺失项明确写“未识别”，允许自然语言修正。
5. 确认后客户端本机事务保存。

不要由模型生成医学结论；报告原文与 AI 便捷摘要明确分开。

## 5. Cloud / Desktop 交互协议（建议）

现有 Agent 的 session/approval API **只能在服务器侧执行其白名单写操作**，不应伪装成能直接修改本机 SQLite。

因此新增 **Medical Import Client Commit 协议**：云端负责提案，桌面负责本机提交。以下为拟设计的接口名称，不代表现有 API：

| 方法 | 路由 / 命令 | 内容 |
| --- | --- | --- |
| `POST` | `/api/v1/medical/imports` | 创建用户绑定的短期批次，返回 batchId 和上传能力 |
| `POST` | `/api/v1/medical/imports/{id}/assets` | 身份认证 multipart 图片/PDF，受文件数/大小/类型限制 |
| `POST` | `/api/v1/medical/imports/{id}/extract` | 启动模型识别，返回 jobId |
| `GET` | `/api/v1/medical/imports/{id}` | 查询 job 状态及用户独占的短期草稿结果 |
| `DELETE` | `/api/v1/medical/imports/{id}` | 取消/清理临时文件与识别数据 |
| `POST` | `/api/v1/medical/imports/{id}/complete` | Desktop 提交成功后回传**非敏感状态**用于会话展示 |
| `Tauri IPC` | `medical_stage_files` | 用户确认后保存原件并生成本机 assetIds |
| `Tauri IPC` | `medical_store_draft` | 短期识别草稿放在当前页面内存，不写普通 Agent 会话 |
| `Tauri IPC` | `medical_commit_draft` | 校验 + 去重 + 一次事务 + 返回 recordIds |
| `Tauri IPC` | `medical_list_reports` / `medical_get_report` | 按当前本机 profile 查询和预览数据 |
| `Tauri IPC` | `medical_export_backup` / `medical_import_backup` | 可选本机备份与恢复，包含全部报告原图与数据库 |

**设计关键**：

- `POST /api/v1/medical/imports/...` 不必复用一般聊天 `prompt`，但必须由当前 Agent 会话 UI 发起，批次通过不含医疗正文的 `batchId` 和会话关联。
- 医疗图片、完整结构化草稿**不写入通用会话消息文本、Agent 记忆、已有 `agent_approvals.action_json` 或普通服务日志**。
- 归档确认在 Desktop 展示专用 `MedicalImportReviewCard`，而不是调用会把服务器数据写入 Sync 的旧 Approval Executor。
- 服务端不能反向连接用户 `localhost` 或绕过本机身份验证。客户端主动提取草稿、用户确认后由 Tauri IPC 提交。
- 完成回执只包含成功/失败状态、批次 ID、非敏感数量；提示卡上显示真正结果必须以本机 IPC 返回值为准。
- 定义 Cloud/TS/Rust 共用的 JSON schema 版本（v1）并增加契约一致性测试，禁止三端漂移。
- 现有 `/api/v1/web/assistant` 文本能力保持原样，新增医疗附件流程不得使旧客户端不兼容。

### 5.1 临时数据生命周期

- 短时 Cloud 文件采用独立目录/独立存储前缀、随机 ID、身份与会话绑定、加密静态存储，限制权限与访问次数。
- **首版实际限制**：最多 8 份原始文件，单张图片 5 MiB、单个 PDF 20 MiB、原件总计 30 MiB；PDF.js 将每页渲染成临时 JPEG，最多 8 个视觉页面、视觉图像共 12 MiB；超出限制明确提示分批处理。
- 作业成功、明确取消时尽快主动清理；异常断电和超时通过服务端周期清理兜底。建议短期保留上限 24 小时（配置可调），用户界面明确说明。
- 不在持久 Agent 记忆保留医学正文；配置文件、request tracing、error tracking、第三方模型供应商保留策略应另行核实，不宣称模型服务必然零保留。
- HTTP 上传失败可重试但以 batchId/hash 去重；不要在日志打印 multipart body 或原始 JSON。

## 6. Desktop 本地普通文件归档：可靠写入和恢复

### 6.1 普通本地存储策略

- 不需要 Medical Vault、SQLCipher、Argon2 或额外解锁步骤；用户选择医疗数据不加密。
- Rust 端通过 `medical_commit_draft` 写入 `medical_import_batches`、`medical_reports`、`medical_report_sections`、`medical_observations`、`medical_report_assets`、`medical_report_asset_links`。
- 每次提交由 `idempotency_key` 防重。用户确认后，将完整原始字节保存到 `data_dir/medical/originals/<UUID>.<ext>`，记录 SHA-256，存储路径不使用上传者提供的目录。
- 文件保存失败或 DB 提交失败回滚并清理本次生成的文件；后续需补充崩溃后 orphan reconciliation。
- SQLite 业务字段、医院名称、检查结论和源文件名都以普通明文保存。具备本机文件访问权限的程序可以读取这些医疗内容，备份也同样是明文。
- 只能通过数据库登记过且属于当前 profile 的 asset ID 读取文件，检查路径并在读取时验证 SHA-256。
- 医疗数据不进入普通 Sync、Agent 会话持久化、通用搜索索引或常规日志。
- 备份应同时包含 `lifetrace.db` 与 `medical/originals`，恢复时检查原件哈希和关联引用。

### 6.2 迁移

- 在 `src-tauri/src/database/migrations/mod.rs` 注册下一个**未占用**版本；当前 v21 最后，v18/v19 不可复用；建议首个医疗 migration v22。
- 先新增表与索引，不改变原有 LifeData、照片、Notes、Travel/Footprints 表。
- 迁移前自动备份；测试升级、重复运行、迁移失败回滚、降级时的明确错误提示。
- **不添加** `medical.*` 到现有通用 Sync registry；本阶段 local-only。

## 7. 前端界面

### 7.1 Agent 输入

目标改动：

- `src/components/CloudAgentModule.tsx`：支持附件按钮、拖放、文件预览、批次上传进度、多图重试、删除待发附件、隐私告知；
- `src/services/cloudAgentApi.ts`：保留文本接口，添加 medical import job API；
- 增加 `MedicalImportReviewCard`：只展示当前草稿报告、指标行、来源页、异常项、重复提醒和“一键归档”，不提供完整手填表单；
- 自然语言纠错会更新**本机草稿版本**，而非让模型静默改正式数据；点击确认后校验草稿版本，防过时确认。

### 7.2 健康页面

- 保留 `DesktopHealthModule` 原有健康概览功能。
- 添加“检查记录”与“指标趋势”子页面，历史记录按事件/报告组织。
- 单击记录查看原件与提取结果并排，点击结果跳转来源页。
- 搜索和趋势在本机资料中计算，不受私密相册解锁状态影响。
- Agent 修改、重新提取、删除须有明示目标、差异预览和确认；删除也不能绕过医疗对象清理和审计。

### 7.3 未来 Agent 历史查询（P2）

云端 Agent 不能直接读取本机 SQLite。要支持“比较去年和今年 ALT”：

- 提供受控 `medical_query_local` 客户端工具调用协议，返回最小必要字段；每次查询执行前验证当前账号和请求范围；
- Cloud 仅临时持有本次查询授权的最小数据，不永久复制整个医疗库；
- 趋势数值在本机计算，Agent 只解释真实返回值，回答注明数据日期/来源；
- 首版可以先只做健康页面只读浏览，避免把长期医疗库同步至 Cloud 才能搜索。

## 8. 执行任务清单与建议顺序

### Phase 0：冻结接口和安全基础

- [ ] 检查 desktop/cloud 现有鉴权、会话、文件 API、最大 Body Size 和网络失败逻辑；
- [ ] 确定 MedicalExtractionDraftV1 与 schema 测试样本；
- [ ] 确定视觉模型真实支持的图片/PDF input API；不得假设模型名天然支持；
- [ ] 设计临时 Cloud 文件 TTL、敏感数据排除策略及隐私说明；
- [ ] 确认独立医疗报告文件目录，不触及原有私密相册；
- [ ] 确认本机普通文件数据目录权限与备份策略。

### Phase 1：完整闭环（可发布 MVP）

- [ ] Desktop 选择/拖入多张照片和 PDF、图片在本机内存暂存，确认后原样保存；
- [ ] Cloud 专用上传、job、状态查询、临时文件清理；
- [ ] Vision Provider 图片 part、PDF 可选按页渲染、结构化响应；
- [ ] 实现血检/生化的**全部可读行**（数字、文字结果、单位、当次参考范围、原报告高低标记）；
- [ ] 实现彩超的检查所见、原文结论、测量尺寸、分级；
- [ ] 多图片报告聚类和不同报告拆分；
- [ ] 独立医疗文件目录、migration、repository、IPC、幂等 commit；
- [ ] Agent 预览、一键确认、失败恢复、保存成功回执；
- [ ] 健康页面完整浏览原件和结构化数据。

### Phase 2：长期使用能力

- [ ] 重复导入同一原件、同报告的不同照片的去重与确认；
- [ ] 通过对话更正并建立 revision/audit；
- [ ] 指标别名规范化与单位冲突检测；
- [ ] 历次检测趋势；仅合并语义/单位相容的数据；
- [ ] 重新识别已归档原件（新版本作为候选；不能覆盖原始事实）；
- [ ] 普通文件备份/恢复、文件缺失和哈希校验测试；
- [ ] Agent 本机历史查询（最小范围授权）。

### Phase 3：可选扩展（不是完成 MVP 的前提）

- [ ] 胃镜、病理、心电图、尿检、CT/MRI 等更多 fixture；
- [ ] 支持更多结构化 observation kind；
- [ ] 批量导出 CSV/JSON（明确明文导出风险）；
- [ ] 可选医疗专用加密同步——必须单独评审，不加入普通 Sync。

## 9. 测试矩阵与可复现验收

### 9.1 测试集

所有自动化测试使用**合成/脱敏** fixture，不把用户真实检查报告提交 Git 或测试日志。

| 测试样本 | 核心验收 |
| --- | --- |
| 两页血液生化检验 | 所有清晰可读的指标逐行保存；单位、参考范围、H/L、页序正确 |
| 甲状腺彩超 | 所见原文、结论原文、双侧部位和测量值、TI-RADS 仅按报告保留 |
| 多份报告混传 | 能区分同次体检事件里的不同报告；不误合并 |
| 不同受检人 / 不同日期 | 归组冲突提示并阻断自动合并 |
| 模糊图片 / 缺半页 | 不猜缺失数字，不以当天替代检查日期，标记待核对 |
| 定性结果 | 阴性、阳性、未检出、“<0.5”等不会被数值截断 |
| 重复同图 / 网络重试 / 双击提交 | 只创建一次报告，不产生孤儿原件 |
| 写入中断 / 断电 | 重启后 staging/DB 能协调恢复 |
| 非本人会话 / 非当前 profile | 不能读取或提交数据 |
| 不兼容视觉 provider | 给出能力错误，不生成伪报告 |
| 云端清理 | 任务完成、取消与过期后临时对象得到清理；审计中无报告正文 |
| 备份 / 恢复 | 文件 SHA-256 一致、报告关联和结果数值完整 |

### 9.2 工程门禁

Desktop：

```bash
npm run lint
npm run test:unit
npm run web:build
npm run test:rust
```

Cloud：

```bash
cargo fmt --check
cargo test --locked -- --test-threads=1
cargo clippy --locked --all-targets -- -D warnings
```

除了单元测试，必须在 Windows/Tauri 桌面真实验证：三张多图上传、取消/重试、云端模型返回、预览确认、重启后查看原始图片、一次批次生成多个报告、修订/重识别与本机报告文件完整性。静态类型检查通过不代表视觉 API 真正可用。

### 9.3 MVP 完成定义（Definition of Done）

同时满足：

1. 用户**只通过 Agent**发送血检和彩超图片，不打开手工表单；
2. 多模态视觉模型直接识别，Agent 返回真实的结构化草稿；
3. 所有可辨认血检行、彩超所见和结论、原始附件都保存，无法识别的字段不杜撰；
4. 用户一次确认后本地事务入库，能立即在健康工作区查看；
5. 每条结构化字段可追溯到原图/页；
6. 原图、敏感正文及草稿不以明文写入普通 SQLite/WAL、聊天历史、日志或云端长期数据库；
7. 重试、取消、重复导入、离线和失败不制造重复或破损记录；
8. Desktop+Cloud 测试和 Windows 实际端到端验收通过。

**MVP 不依赖**历史 Agent 查询、完整 FHIR Server、跨设备医疗同步，也不依赖任何独立 OCR 组件。

## 10. 项目参考与不采纳范围

- **Soma**（MIT）：https://github.com/mdportnov/soma —— 参考 `src/ai/import/registry.ts`、`src/ai/import/docs/lab.tsx`、`src/ai/import/docs/imaging.tsx`、`src/ai/pipeline/map.ts`、`src/db/schema.ts`、`src/lib/import-duplicates.ts`、`src/components/charts/TrendChart.tsx`。
- 可参考其多模态直读、严格抽取、先 review 再 save、指标字典、重复导入和数据来源追踪。
- **不要照搬** Soma 的完整疾病/药物/疫苗系统、单独 Import Wizard、部分日期回退为当天的行为或过于简化的影像 findings 字段。
- Soma 使用 MIT 许可证，若实际复用代码需保留许可证与署名、核查第三方依赖；当前计划以自行实现为主。

## 11. 推荐实施切片 / PR 边界

为避免两仓库大改后无法定位问题，建议按以下顺序独立提交并验收：

| PR | 仓库 | 可验证交付 |
| --- | --- | --- |
| A | Desktop | 医疗普通文件存储 / schema / repository / migration / IPC，纯合成数据测试 |
| B | Cloud | 视觉附件上传 / 临时存储 / job + 提取契约，仅返回候选，不写 Desktop |
| C | Desktop | Agent 附件与预览卡、客户端审批和事务 commit，闭环 E2E |
| D | Desktop | 检查历史详情、原图查看、指标查询与趋势 |
| E | Cloud + Desktop | 去重、更正、重新提取、短期材料清理和错误恢复 |

**本计划仅创建文档，不隐含任何上述 PR 已经实现、测试通过或部署。**

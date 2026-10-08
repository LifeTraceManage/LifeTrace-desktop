# LifeTrace Desktop · Agent 驱动医疗检查报告归档方案

> **工程实施清单**：参见 [Agent 医疗报告归档实施方案](MEDICAL_AGENT_IMPLEMENTATION_PLAN.md)。接口、安全、数据表、阶段任务及验收以实施方案为准。

> 状态：方案更新（Agent-first；尚未实现）  
> 仓库：`LifeTraceManage/LifeTrace-desktop`  
> 用户目标：**把医疗检查报告照片或 PDF 发给 LifeTrace 云端 Agent，由 Agent 识别并填写检查记录。**  
> 用户交互：**上传报告 → Agent 提取 → 查看归档预览 → 一键确认**。不要求手动填写检查表单。  
> 产品范围：只管理每次医疗检查报告，包括血检、尿检、彩超、CT、MRI、心电图、体检等；不建设完整医疗病历/诊疗系统。

## 1. 最终产品体验

### 1.1 唯一主要录入方式：对话

用户在 `/app/assistant` 的云端 Agent 输入框发送一张或多张检查报告照片、扫描件或 PDF，也可以补充一句自然语言，例如：

- “把这份血常规报告记录下来”
- “这是我今天做的腹部彩超”
- “这三页都是同一次体检，归档一下”
- “我传错日期了，检查日期是 9 月 30 日”
- “把刚才记录的转氨酶数据改成报告上 36 U/L”

Agent 不要求先打开“健康 → 新增检查”，也不要求用户逐项填表。

Agent 应：

1. 自动判断报告类型；
2. 识别检查日期、机构、检查名称、项目及报告结论；
3. 根据报告类型提取数值表或影像描述；
4. 将多页/多张属于同一报告的材料合并，将不同检查分成不同记录；
5. 返回结构化归档预览，并标记低置信度/缺失字段；
6. 用户点击一次“确认归档”后，执行实际保存；
7. 回复“已归档”，附带可打开的记录定位信息；
8. 支持后续在对话中询问历史：如“去年和今年的血常规有什么变化”，必须基于已归档的实际值。

**没有复杂编辑表单。** 用户更正用自然语言说即可，Agent 重新生成修订草稿，并保留变更前后差异。

### 1.2 报告类型差异

| 类型 | Agent 必须提取 | 不允许的假设 |
| --- | --- | --- |
| 血常规/生化/激素/尿检等检验报告 | 检查名称、日期、医院、所有清晰可读的指标行：项目名、数值或文字结果、单位、参考范围、原报告高低标记 | 不得编造看不清的数值、自动猜单位 |
| 彩超（腹部、甲状腺、心脏等） | 部位、检查方式、检查所见、报告“提示/印象/结论”原文、日期、医院 | 不得把描述推断成新诊断 |
| CT / MRI / X 光 | 部位、检查所见、报告结论、日期、医院 | 不得凭图像自行作医学影像诊断；输入通常是报告照片而非原始 DICOM |
| 心电图 / 其他专项检查 | 项目名称、机器/医生报告中的文字结果及可读数值 | 不得生成报告未写的诊断 |
| 常规体检多页报告 | 按检查项目合理归组：同一体检事件可包含多个子报告 | 不得把不同日期/医院/受检人误并为一个检查 |

报告**原图必须保存**，结构化数据是可修正索引，不取代原始报告。

### 1.3 归档结果的展示

`成长健康 → 健康` 增加“医疗检查记录”只读工作区：

- 列表：按日期倒序、检查类型、机构；
- 详情：自动提取的日期、检查名称、报告所见、结论、指标表；
- 附件：原图/PDF，按上传顺序预览；
- 趋势：对相同名称/同一单位的常见检验指标查看多次结果；
- 管理动作：通过 Agent 对话修改、合并、重新识别、删除（删除需要明确确认）。

保留当前的坚持/训练/复盘概览，避免改坏已有健康数据。不建设单独的医生、疾病、处方、药物、疫苗模块。

## 2. 当前代码现状（已检查）

### 2.1 Desktop

- `src/components/CloudAgentModule.tsx` 目前只有文字输入框、发送、会话记录及审批区；**没有附件选择/预览/图片消息展示**。
- `src/services/cloudAgentApi.ts` 的 `ask(prompt, sessionId)` 只发送 JSON 文本 `prompt` 和 `pageContext`，不发送文件。
- `src/components/DesktopNativeRouteContent.tsx` 已存在 `/app/assistant` 和 `/app/health`。
- `src/components/DesktopHealthModule.tsx` 当前汇总坚持、训练、每日复盘，并非检查记录列表。
- 桌面由 Tauri/React + Rust/rusqlite 支撑；SQLite migration 和图片私密 Vault 已存在。

### 2.2 Cloud：实际当前使用的云端 Agent

LifeTrace 当前云端 Agent 的实现与服务在：

- `LifeTraceManage/LifeTrace-cloud`：Rust Axum + Rig Agent；
- `/api/v1/web/assistant`（桌面调用）与 `/api/v1/assistant`；
- 既有 Agent 会话、工具、写操作审批框架；
- 写入的现有白名单主要覆盖任务、日历、习惯、Memo 等；**尚无医疗检查写操作**；
- Cloud 已有 `/api/v1/files/*` 对象存储元数据和签名入口，但不等于 Agent 已实现图像输入。

独立仓库 `LifeTraceManage/LifeTrace-agent` 是另一套 LangGraph/12306 Agent，并非桌面 `CloudAgentModule` 当前实际连接的运行时。**本功能应扩展 LifeTrace-cloud 的现有 Rig Agent，而不是另建第二套 Agent 或恢复桌面本地 Agent。**

因此不能仅靠 Prompt 修改实现：至少需要文件传输、多模态识别能力、typed extraction、持久化工具和审批机制。

## 3. Agent 归档工作流

```text
桌面 Agent 对话窗口
   └─ 用户发送 1..N 张报告照片 / PDF + 可选文字
        ↓
桌面创建本机待归档草稿（保存原图、hash、上传顺序）
        ↓
用户获知并同意上传至云端供模型识别
        ↓
安全的短期云端上传 / 限时识别引用
        ↓
LifeTrace-cloud Agent 直接调用视觉多模态模型识别原始报告图像
   ├─ 文档类型分类
   ├─ 检查事件聚类（日期、机构、受检人、报告单号）
   ├─ 基础字段提取
   ├─ 血检/尿检指标逐行提取
   ├─ 超声/影像所见及报告原文结论提取
   └─ Evidence + 置信度/歧义记录
        ↓
结构化 MedicalExamExtractionDraft
        ↓
Agent 对话中展示结构化预览 + 需要确认的疑点
        ↓
用户点“确认归档”或者以自然语言更正
        ↓
桌面受控执行本机医疗记录写入（一次事务）
        ↓
Agent 返回已保存记录 ID、数量及跳转入口
        ↓
健康 → 检查记录（列表 / 详情 / 趋势）
```

### 3.1 提取 ≠ 直接入库

Agent 仅生成受类型约束的候选结构，不能自己生成 SQL、文件路径、用户 ID、保存命令或修改其他业务模块。

**默认一次确认即可保存。** 以下情形必须强调提示、需要用户更正或主动确认：

- 检查日期不确定；
- 两张照片可能来自不同受检人/不同日期；
- 数值、负号、小数点、单位或参考范围难辨；
- 多页可能不是同一次检查；
- 系统发现似乎已经归档过这份报告。

所有“看不清/没有提供”的字段设为 null 并显示未识别，**不猜日期/医院/项目数值**。不能用当前上传时间冒充检查日期。

### 3.2 文件分组

- 多张同一报告照片以 `upload_batch_id` 聚合；
- 用报告单号、受检人可匹配信息、日期、机构、检查类别辅助识别；
- 如果同一上传批次出现不同机构/日期/受检人，默认拆分候选检查事件并提示；
- 从不同页识别到同一指标时，必须标明来源页并判定是否重复或属于不同样本；
- 支持用户在对话里说“这两页是一份”“分开保存”。

### 3.3 幂等与重复处理

使用：

- 本机原图 SHA-256；
- `upload_batch_id`、`source_file_id`；
- 可识别的报告编号；
- 检查日期/机构/项目组合。

Agent 写入前调用确定性 duplicate check。相同图重复上传不创建重复记录；不同照片但同一报告尝试合并附件，遇到歧义必须确认。Agent 重新运行/网络重试、用户重复点击确认时，`idempotency_key` 保证单次写入。

### 3.4 人工纠正

用户说“红细胞计数是 4.82，不是 4.28”，Agent：

1. 查询定位具体检查/具体指标；
2. 返回更正提案与源图证据；
3. 用户确认；
4. 受控更新数据库并记录修订历史。

不得仅修改聊天答复却不更新已保存记录，也不得在未定位记录时修改其他检查。

## 4. 数据模型

首版就支持指标，因为**自动识别并归档血检的每一行数据是核心需求，不是后续增强**。

### 4.1 `medical_exams`

```text
id, user_id, exam_date, report_date,
title, exam_type, organization_name, department,
exam_region,                   -- 彩超 / CT / MRI 等检查部位
findings_text,                 -- 原报告“检查所见”（如有）
conclusion_text,               -- 原报告“结论/提示/印象”（如有）
report_summary,                -- 索引性摘要，不能替代原文
source_kind,                   -- agent_import
extraction_status,             -- draft / confirmed / needs_review
source_batch_id,
created_at, updated_at, deleted_at
```

如果日期未知，`exam_date` 可以为 null；标记 `needs_review`。不要为了符合数据库非空约束而伪造日期。保存后可按检查日期排序，日期缺失单独分组。

### 4.2 `medical_exam_results`

```text
id, exam_id,
metric_name, metric_key,        -- metric_key 可为空；仅确认同一语义后规范化
value_number, value_text,
unit_raw, reference_range_raw,
reference_low, reference_high,
source_flag,                   -- 仅报告标记的 H/L/异常/阴性等
sample_time,
source_attachment_id,
source_page,
source_bbox_json,
source_quote,
confidence,
created_at, updated_at
```

结果记录属于一次检查。允许文字结果（阴性/阳性/未检出）、范围上限/下限、化验数值。不做静默医学单位换算，不做模型生成的疾病诊断。

### 4.3 `medical_exam_attachments`

```text
id, exam_id, original_filename, mime_type, byte_size,
encrypted_object_id, sha256,
page_count, upload_order,
created_at
```

### 4.4 `medical_import_batches` 与 `medical_exam_revisions`

- `medical_import_batches`: 原上传批次、文件 hash 集合、识别状态、失败/中断状态、可恢复的本机草稿 ID；
- `medical_exam_revisions`: 每次更正/合并的 before/after 快照或字段差异、操作来源及时间。

不要把完整敏感报告内容放在通用 Agent Session `content`、`actionJson`、`pageContext`、普通日志或未经保护的同步事件里。

## 5. 技术边界：Agent 在云端，档案在本机

用户说的“纯用 Agent 实现”指**录入和修改只需与 Agent 对话**，不意味着医疗数据本身不用数据库，也不意味着所有本机记录都上传并长期保存在 Cloud。

### 推荐首版：云端识别，本机归档

| 责任 | 所在端 | 说明 |
| --- | --- | --- |
| 文件选择/拍照及原图持有 | Desktop | 同一 Agent 聊天界面上传；原图先留本地 |
| 直接视觉识别/字段抽取（无独立 OCR） | LifeTrace-cloud / 视觉模型提供方 | 将获授权的原始图片或 PDF 页面直接作为视觉输入 |
| 提取字段 schema 验证 | Cloud + Desktop | 模型输出当作非可信候选数据 |
| 草稿预览/询问用户更正 | Agent 对话 UI | 展示异常字段和图片证据 |
| 最终记录与原图持久化 | Desktop Rust + SQLite / encrypted object store | 不由 Cloud Agent 直接连本机数据库 |
| 检查历史与指标趋势 | Desktop Health | 本机只读查询 API，未来可选同步 |

**特别注意**：当前 Cloud 的审批执行器只能在服务器侧对当前允许的对象执行写入，不能直接修改用户机器上的 SQLite。

首版需要实现专门的 **`MedicalArchiveAction` 客户端受控执行协议**：

1. Agent 生成经过 schema 校验的 `medical_exam.commit` 候选动作；
2. Cloud 将一次性 `draft_token` / `draft_id` 和脱敏状态返回桌面端；
3. 用户在桌面 Agent 对话界面确认；
4. 桌面端从本机加密草稿读取结构化数据，调用 Tauri IPC `medical_exam_commit_draft`；
5. Rust 校验当前登录 profile、草稿所属会话、附件归属、重复提交 key；
6. Rust 在事务中创建检查与结果，管理附件加密对象并反馈；
7. Desktop 仅在收到成功回执后显示“已归档”。

草稿结构化数据需通过一次性安全响应交付并存入**本机受保护草稿存储**，不要长久塞在 Cloud 的 Agent 对话历史/审批 JSON 中。不能从 Cloud 向客户端 localhost 打开未经认证的反向写入通道，也不能相信模型可自行完成本机写入。

未来如果确实要求跨设备共享，可另行设计 opt-in 的医疗专用加密同步；它不是本次 MVP 必须项。

### 5.1 运行时能力探测与纯视觉模型策略

目前 Cloud 采用 Rig 和可配置 `MODEL_PROVIDER`/`MODEL_NAME`。并不是所有配置的 provider/model 都能接收图片。

实现时必须：

- 在上传界面/服务端校验该 provider/model 的 image input capability；
- **必须使用实际支持图片输入的多模态视觉模型**，直接读取照片中的表格、文字、日期、医院、检查所见和结论；不实施 OCR -> text fallback；
- 对图片直接提交原图（可做旋转/缩放/去除界面边框等不改变报告信息的预处理）。对 PDF：模型接口支持原生 PDF 时可直接发送；否则仅使用 PDF 渲染器按页转换为图片并交给视觉模型，**不采用 OCR 或单独的文档文本解析流水线**；
- 任何 provider 不支持图像时明确报错或要求切换，**不能假装图片已被识别**；
- 上传必须有大小、格式、页数、分辨率限制，并有明确失败反馈。

### 5.2 多模态识别输出规则

AI 直接读照片并不等于识别结果总是准确。模型应输出版本化的结构化 JSON，并保留证据关联：

- **完整原文优先**：除可比较的结构化检验值，还保存通用 `report_sections`（“检查所见”“诊断/提示”“病理描述”等原文章节），避免无法预料的新报告类型丢数据。
- **逐行提取**：血检/尿检等报告逐项输出原始项目名、原始值、单位、参考范围、原报告高低标记；超声/影像报告保留原文并额外提取测量数据。
- **证据定位**：每项结果记录源图、源页、原文片段；如提供位置坐标，必须在预览上验证与原图一致。
- **不确定字段**：不清楚的数字/单位/日期以 `null` 和 `needsReview` 表达；不能依靠常识猜值。
- **校验独立于模型**：应用端使用确定性 schema、数值格式、时间、单位原文及去重规则验证，但不将“数值是否正常”作为可接受性判定。
- **用户确认**：识别预览须允许在对话里纠错；用户确认后才调用本机受控存储 API。
- **失败策略**：视觉输入不被模型/API 支持时明确提示模型不兼容或图片质量问题；**不悄悄切换到 OCR**。

这种“直接图片 → 多模态模型 → JSON 草稿”的路线是本项目明确需求，不另设 OCR 服务、OCR SDK 或双引擎流水线。

### 5.2 后端工具而非 Prompt 魔法

Agent/应用协议应包含：

- `medical_exam.extract_report`：返回 typed `MedicalExamExtractionDraft`；
- `medical_exam.find_duplicates`：确定性重复检查；
- `medical_exam.propose_archive`：生成受控归档提案；
- `medical_exam.find_existing`：只读定位历史记录（桌面执行）；
- `medical_exam.propose_correction`：生成差异提案；
- `medical_exam.commit_draft`：客户端审批后 Tauri 执行；
- `medical_exam.delete`：显式二次确认并执行。

Cloud Agent 应增加受策略约束的医疗场景能力；不得直接给通用 Tool Registry 授权任意 SQL / 任意本机文件读写。

## 6. 安全与隐私

### 6.1 正确认知云端处理

由于用户将报告照片发送给**云端 Agent**，与旧版“完全本地解析”的设想不同：

- 图像会经 HTTPS 上传到 LifeTrace-cloud；
- 如果使用外部视觉模型，报告内容还会发送给**实际模型服务提供商**；
- 不能承诺“图片永不离开本机”或“端到端加密且云端看不到明文”；
- 首次使用提供清晰授权与 provider 信息，后续可在设置中随时关闭；
- 处理时只暴露必要信息，尽可能移除传给模型的姓名/身份证号/手机号等非提取必需字段（在不破坏报告理解的前提下）；
- 不将医疗报告进入普通 Agent 记忆、搜索索引、通用分析和后台提示词；
- 临时原文/图片上传对象必须有明确 TTL 和可验证删除机制；
- 审计只记录 job/draft/动作元数据，不记录原始医疗正文；
- 特别审查第三方模型的 retention、训练使用条款，不做没有依据的零保留承诺。

### 6.2 本地保存

- 当前主 `lifetrace.db` 未加密；医疗正文/指标/原图需要独立安全存储设计；
- 原图建议用 Vault 通用 AES-GCM encrypted object store（抽离图片专属语义）；
- 敏感结构化内容使用字段级加密或独立加密 medical DB，不明文塞普通全局查询表；
- 当用户锁定医疗数据时，禁止通过 Agent 历史、普通搜索或缓存泄漏已提取内容；
- 允许本机加密备份和恢复；备份时包含数据与附件，验证 hash 与可读取性。

### 6.3 医疗准确性

- 始终保留来源页码/图片序号及必要的文字证据；
- 数值、单位、报告原文结论需可追溯；
- 医学含义不确定的字段标记待复核；
- 报告原本标记的异常/临界值可原样展示；
- **不自动诊断、不开药、不提供脱离报告的治疗结论**。

## 7. 推荐的数据契约

```ts
type SourceEvidence = {
  attachmentId: string;
  pageNumber?: number;       // 页码从 1 开始
  bbox?: [number, number, number, number];
  sourceQuote?: string;
  confidence: number;         // 帮助审核，不能作为准确率保证
};

type MedicalExamExtractionDraft = {
  draftId: string;
  uploadBatchId: string;
  reports: Array<{
    reportKind: "laboratory" | "ultrasound" | "imaging" | "ecg" | "other";
    examDate: string | null;
    reportDate: string | null;
    title: string;
    organizationName: string | null;
    department: string | null;
    examRegion: string | null;
    findingsText: string | null;
    conclusionText: string | null;
    metrics: Array<{
      metricName: string;
      valueNumber: number | null;
      valueText: string | null;
      unitRaw: string | null;
      referenceRangeRaw: string | null;
      sourceFlag: string | null;
      evidence: SourceEvidence;
    }>;
    sourceAttachmentIds: string[];
    needsReview: boolean;
    reviewReasons: string[];
  }>;
  duplicateCandidates: Array<{ examId: string; reason: string }>;
};
```

这个 schema 是开发时的最小契约示意，需要最终与 Rust/TypeScript contracts 对齐。Agent 的 JSON 输出必须做运行时校验。报告正文允许空值，不使用“凭空补齐必填”的技巧。

## 8. 所需仓库改动

### LifeTrace-desktop

- `src/components/CloudAgentModule.tsx`：图片 / PDF 上传、预览、进度、批量附件、Agent 归档预览卡、确认操作；
- `src/services/cloudAgentApi.ts`：支持携带安全文件引用的多模态请求，typed draft/commit status；
- `src/components/DesktopHealthModule.tsx`：健康检查列表、详情及检测值趋势的只读工作区；
- `src/services/medicalExamApi.ts`：本机 IPC 查询 / 提交 / 备份；
- `src/types/medicalExam.ts`：严格的记录与草稿类型；
- `src-tauri/src/commands/medical_exam.rs`：本机事务写入与查询；
- `src-tauri/src/application/medical_exam.rs`：归档动作策略和幂等；
- `src-tauri/src/database/repositories/medical_exam.rs`：数据持久化；
- 数据库 migration、Medical Vault 扩展、备份和测试。

**不再设计 `ExamForm.tsx` 一类手工创建界面作为入口。**

### LifeTrace-cloud

- Agent 请求/会话扩展为带安全附件引用的多模态消息；图像识别直接由视觉模型完成，禁止额外 OCR 中间流程；
- 短期文件接收 / 图像预处理 / PDF 渲染为图片（如模型不原生支持 PDF）；**不引入 PaddleOCR、Docling、MinerU 或其他独立 OCR/文档提取引擎**；
- 实际可用 vision provider 的能力校验；
- `MedicalExamExtractionDraft` 严格 schema 提取；
- 医疗场景的受控 tool/capability + 预览/纠错；
- 防止敏感 payload 写入现有通用持久会话与审计日志；
- 一次性安全归档提案/状态回执；
- 相关鉴权、临时数据清理、重复识别和失败重试测试。

不要把该功能转移到 `LifeTrace-agent` 仓库，不建立第二套 Agent 生命周期。

## 9. 实施顺序和验收标准

### P0 — 打通“照片 -> Agent -> 本机检查记录”闭环（首要）

- [ ] 云端 Agent 聊天支持拖入/选择照片，显示发送中的状态；
- [ ] 后端配置可处理图片的模型；不能处理则清晰拒绝；
- [ ] 实现单张血检报告与单张彩超报告的分类和结构化提取；
- [ ] 支持一次发送多张同报告的照片；
- [ ] 从血检提取整张指标表（尽力逐项保留，无法确认的标注疑点）；
- [ ] 从彩超提取“检查部位/检查所见/报告提示或结论”；
- [ ] Agent 展示预览，用户不打开表单也能确认/纠错；
- [ ] 用户批准后，桌面 Tauri IPC 一次事务保存记录、检测值和原图；
- [ ] 健康页面可以查看已保存内容；
- [ ] 拒绝/失败不产生半成品记录；
- [ ] 重启后可正常查看，云端 Agent 不长期保存明文报告内容。

### P1 — 稳定性

- [ ] 同一份报告重复上传去重；
- [ ] 多报告批量导入、拆分/合并；
- [ ] 对话式修正与修订历史；
- [ ] 血检/生化指标趋势；
- [ ] PDF（原生多模态支持或按页渲染为图片）处理；
- [ ] 加密备份与恢复；
- [ ] 权限、过期、取消、恢复及中断重试。

### P2 — 非必需增强

- [ ] 支持多语种报告；
- [ ] 用户指定某些指标自动归类；
- [ ] 导出结构化 CSV/JSON；
- [ ] 可选医院 FHIR 格式导入（不做完整 FHIR Server）。

### 必须覆盖的测试

1. 血常规：小数点、负号、单位、参考范围与异常标记正确；
2. 彩超：分别提取检查所见和医生报告结论，不生成新诊断；
3. 同一报告的两张分页正确合并，不同报告不乱合并；
4. 低质量图片/遮挡数据不能凭空补齐；
5. 报告日期无法识别时允许待复核，不用上传日期冒充；
6. 同一批次重复提交/重试不会重复建档；
7. 提交失败时不丢草稿、不产生孤儿文件；
8. 非本人会话和过期 token 不能提交；
9. 普通 Agent Session/日志/全局搜索不意外泄露病历内容；
10. 云端模型不支持图像时可见明确错误；
11. Windows/Tauri 实际附件上传、预览、确认、持久化端到端测试；
12. `npm run lint`、`npm run test:unit`、`npm run web:build`、`npm run test:rust`，加上 Cloud 相关 Rust 测试。

## 10. 参考项目和技术边界

相关开源项目：

- Soma（MIT）：https://github.com/mdportnov/soma —— 桌面健康检查时间线和指标；
- Vitametr（MPL-2.0）：https://github.com/ACiDekCZ/vitametr —— 检验数值模型；
- Bloodboy（AGPL-3.0）：https://github.com/ashugaev/bloodboy-biomarkers-tracker —— 报告导入、提取与趋势 UI。

只参考产品结构，不照搬许可证不兼容的代码。

标准参考：HL7 FHIR DiagnosticReport/Observation（https://hl7.org/fhir/R4/diagnosticreport.html）。这些标准说明“同一份报告可包含文字结论、多个原子指标与原始附件”，但 **LifeTrace 此次只使用精简内部模型，无须实现 FHIR 服务**。

## 11. 最终原则

> **用户只发报告；Agent 负责分类、识别、填充、去重和生成归档动作；用户在关键写入时一键确认；桌面 Rust 负责可靠保存；健康页面负责回看和对比。**

“Agent-first”不等于“Agent 绕过权限直接写 SQLite”，也不等于“医疗报告永久放在云端”。本方案将录入体验与数据安全、可靠性分离，既符合交互目标，也能直接衔接现有 LifeTrace 桌面工作台与 LifeTrace-cloud Agent。

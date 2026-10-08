# LifeTrace Desktop 医疗档案模块规划

> 状态：Proposal  
> 目标仓库：`LifeTraceManage/LifeTrace-desktop`  
> 适用范围：桌面端个人医疗档案（Personal Health Record / PHR）  
> 原则：local-first、隐私优先、FHIR-compatible、与现有健康/健身数据解耦但可关联

## 1. 背景

LifeTrace Desktop 已经有 `/app/health` 入口，但当前 `DesktopHealthModule` 主要把坚持、训练、每日复盘汇总为“健康概览”，还不具备医疗档案能力。

现有桌面架构已经提供了适合承载该功能的基础设施：

- Tauri 2 + React 19 桌面壳；
- Rust + rusqlite 本机数据库；
- 版本化 migration、迁移前备份与 integrity check；
- local-first + cloud sync/outbox 架构；
- 独立文件存储目录；
- 私密相册 Vault 已实现 Argon2id + AES-256-GCM、自动锁定、完整性校验等能力；
- 全局搜索、笔记、相册、日历、AI 助手等模块可与医疗档案形成后续关联。

因此不新增一个与现有系统平行的“Medical App”，而是把现有“健康”升级为：

> **健康 = 日常健康状态 + 医疗档案 + 医疗文档 + 检验趋势**

医疗档案的产品定位是个人/家庭 PHR，不是医生端 EMR/HIS，不承担开处方、诊断、收费、门诊工作流等医院业务。

---

## 2. 开源项目参考

### 2.1 HealthWallet.me — 第一参考项目

仓库：

- https://github.com/LifeValue/HealthWallet.me

值得参考：

- patient-controlled / privacy-first；
- offline-first；
- 本地 SQLite；
- FHIR R4；
- Conditions、Medications、Immunizations、Lab Results、Clinical Notes 的信息架构；
- 扫描纸质医疗文件并抽取为结构化记录；
- International Patient Summary (IPS) 导出；
- 生物识别/本地锁；
- 医疗数据与普通生活数据分开的安全边界。

与 LifeTrace 的契合度最高：它同样是“个人拥有自己的医疗数据”，而不是医院业务系统。

注意：项目为 GPL-3.0。LifeTrace 可借鉴产品结构、交互和数据建模思想，不应在未确认许可证兼容性的情况下直接复制代码。

### 2.2 Fasten Health OnPrem — 病历聚合与时间线参考

仓库：

- https://github.com/fastenhealth/fasten-onprem

值得参考：

- self-hosted PHR；
- 个人/家庭而非诊所；
- FHIR 数据聚合；
- Medical History / Labs / Sources；
- 化验指标历史趋势；
- Encounter、Medication、Procedure、Practitioner、Organization、Lab Result、Attachment 的组织方式；
- 多来源记录合并与 provenance。

注意：

- Fasten OnPrem 已在 2026 年归档，只作为产品/数据结构参考，不作为 LifeTrace 的长期依赖；
- GPL 项目，不直接拷贝实现。

### 2.3 Medplum — FHIR 与工程模型参考

仓库：

- https://github.com/medplum/medplum

值得参考：

- FHIR-first 的数据模型；
- Patient / Encounter / Observation / DiagnosticReport / DocumentReference 等资源的组合关系；
- React + TypeScript 医疗 UI 组件思路；
- FHIR import/export；
- provenance、权限、搜索、资源关联。

LifeTrace 不需要引入 Medplum Server，也不需要把本地数据库变成完整 FHIR Server。更合适的方式是：

> 本地使用针对个人档案优化的关系模型，并保留与 FHIR R4 的稳定映射层。

Medplum 为 Apache-2.0，若未来需要引入小型工具或类型定义，许可证相对友好，但仍应单独审查。

### 2.4 OpenMRS — Encounter / Observation 纵向病历参考

仓库：

- https://github.com/openmrs/openmrs-core

值得参考其成熟的数据域：

- Encounter：一次就诊；
- Observation：一次测量/检验结果；
- Condition：疾病/问题；
- Order：医嘱；
- Form：结构化采集；
- Provider / Location；
- 纵向 patient chart。

OpenMRS 面向医疗机构，LifeTrace 不应照搬其权限、挂号、医生工作流，但它的“谁、何时、何地、发生了什么”的病历关系模型很成熟。

### 2.5 OpenEMR / MyGNUHealth — 辅助参考

OpenEMR：

- https://github.com/openemr/openemr

可参考其 FHIR 资源覆盖：AllergyIntolerance、Condition、DiagnosticReport、DocumentReference、Encounter、Immunization、Medication、Observation、Procedure 等。

MyGNUHealth：

- GNU Health 的个人 PHR 客户端；
- 可参考桌面个人病历、个人控制数据的方向；
- 不建议作为现代 UI/工程实现的主要基线。

---

## 3. 标准选择

### 3.1 FHIR 版本

首期以 **FHIR R4 (4.0.1)** 为兼容目标。

原因：

- 生态成熟；
- HealthWallet/Fasten 等个人病历项目以 R4 为主；
- Medplum/OpenEMR 等已有成熟 R4 支持；
- R4 足以覆盖 LifeTrace 首期医疗档案。

FHIR 资源建议映射：

| LifeTrace 概念 | FHIR R4 |
| --- | --- |
| 个人档案 | Patient |
| 就诊 | Encounter |
| 疾病/诊断 | Condition |
| 过敏 | AllergyIntolerance |
| 用药 | MedicationStatement / MedicationRequest |
| 检验单 | DiagnosticReport |
| 检验指标/生命体征 | Observation |
| 疫苗 | Immunization |
| 手术/处置 | Procedure |
| 医疗文件 | DocumentReference |
| 医院/机构 | Organization |
| 医生 | Practitioner |
| 来源/导入记录 | Provenance |

FHIR 中 Observation 适合表达单个测量、生命体征和原子化检验结果；DiagnosticReport 负责把一组 Observation 组织为一次检验/影像报告；DocumentReference 负责 PDF、扫描件、临床文书等文件索引。

### 3.2 不在首期实现完整 FHIR Server

首期不要：

- 实现完整 REST FHIR Server；
- 实现 SMART-on-FHIR OAuth；
- 实现复杂 terminology server；
- 强制所有本地数据原样存成 FHIR JSON。

建议：

1. 本地表使用适合查询和 UI 的 typed schema；
2. 每条记录保留 `fhir_resource_type`、`fhir_id`、`fhir_json`（可选）；
3. 建独立 mapper 负责 FHIR Bundle 导入/导出；
4. 未识别字段可保留在原始 FHIR JSON，避免 round-trip 丢失信息。

---

## 4. 产品信息架构

保留左侧一级导航：

`成长健康 -> 健康`

将 `/app/health` 从单页升级为带二级导航的健康工作区。

建议路由：

- `/app/health` — 健康总览
- `/app/health/timeline` — 医疗时间线
- `/app/health/conditions` — 疾病 / 诊断
- `/app/health/medications` — 用药
- `/app/health/labs` — 检验与指标
- `/app/health/documents` — 医疗文件
- `/app/health/immunizations` — 疫苗
- `/app/health/allergies` — 过敏
- `/app/health/providers` — 医院与医生
- `/app/health/settings` — 医疗档案设置 / 导入导出 / 安全

### 4.1 健康总览

继续显示现有：

- 坚持；
- 训练；
- 心情；
- 精力。

新增医疗档案卡片：

- 当前重要诊断；
- 当前用药；
- 过敏；
- 最近一次就诊；
- 最近检验；
- 异常指标；
- 最近新增医疗文件；
- “紧急信息”摘要。

这样日常健康与医疗记录在同一总览中，但底层数据不混表。

### 4.2 医疗时间线

医疗档案的主视图建议以时间线为核心。

一条时间线事件可来自：

- Encounter；
- Condition 首次诊断/状态变化；
- Medication 开始/停止；
- DiagnosticReport；
- Procedure；
- Immunization；
- Document；
- 手工备注。

支持按：

- 日期；
- 医院；
- 类型；
- 疾病；
- 来源

筛选。

### 4.3 检验与指标

建议参考 Fasten 的 Labs 页面：

- 左侧/顶部：指标分类；
- 主区域：历史值曲线；
- 每个点显示日期、数值、单位、参考区间、来源报告；
- 支持同一指标跨医院归一化显示；
- 原始单位始终保留，不在首期进行高风险的医学单位自动换算；
- 支持 LOINC code（可选）和本地显示名称。

异常标记只使用报告自带 interpretation/reference range，不由 LifeTrace 自行推断疾病。

### 4.4 医疗文件

支持：

- PDF；
- JPG / PNG / WebP；
- 文本；
- 后续可扩展 DICOM / CDA。

文件可关联到：

- Encounter；
- DiagnosticReport；
- Condition；
- Procedure；
- Medication；
- 通用时间线事件。

首期支持“文件 + 元数据”即可；OCR/AI 抽取放到第二阶段。

---

## 5. 本地数据模型

医疗数据不要继续塞进现有 `state_get/state_mutate` 的通用 LifeData 大对象。

新增独立 application/repository/command 边界：

```text
src-tauri/src/
  application/medical/
  commands/medical.rs
  database/repositories/medical/
  medical_vault/
```

前端：

```text
src/components/feature/health/
  HealthWorkspace.tsx
  HealthOverview.tsx
  MedicalTimeline.tsx
  ConditionsView.tsx
  MedicationsView.tsx
  LabsView.tsx
  MedicalDocumentsView.tsx
  ImmunizationsView.tsx
  AllergiesView.tsx
  ProvidersView.tsx

src/services/medicalApi.ts
src/stores/useMedicalStore.ts
src/types/medical.ts
```

### 5.1 建议表

#### medical_profiles

先支持当前账号的一个主档案，同时为家庭档案预留：

- id
- user_id
- display_name
- birth_date
- sex
- blood_type
- emergency_note
- created_at
- updated_at

#### medical_encounters

- id
- profile_id
- status
- encounter_type
- started_at
- ended_at
- organization_id
- practitioner_id
- reason
- diagnosis_summary
- note
- source_type
- source_id
- created_at
- updated_at

#### medical_conditions

- id
- profile_id
- encounter_id
- code_system
- code
- name
- clinical_status
- verification_status
- onset_at
- abatement_at
- note
- source_type
- created_at
- updated_at

#### medical_allergies

- id
- profile_id
- code_system
- code
- name
- category
- criticality
- reaction
- status
- recorded_at
- note

#### medical_medications

- id
- profile_id
- encounter_id
- medication_name
- code_system
- code
- status
- dosage_text
- route
- frequency
- started_at
- ended_at
- reason
- prescriber_id
- note

首期重点是“我正在吃什么 / 什么时候停的”，不是处方开立系统。

#### medical_diagnostic_reports

- id
- profile_id
- encounter_id
- category
- code_system
- code
- title
- effective_at
- issued_at
- organization_id
- conclusion
- status
- document_id
- source_type
- source_id

#### medical_observations

- id
- profile_id
- encounter_id
- diagnostic_report_id
- category
- code_system
- code
- display_name
- value_type
- value_number
- value_text
- unit
- reference_low
- reference_high
- interpretation
- observed_at
- source_type
- source_id

#### medical_procedures

- id
- profile_id
- encounter_id
- code_system
- code
- name
- status
- performed_at
- organization_id
- practitioner_id
- note

#### medical_immunizations

- id
- profile_id
- vaccine_name
- code_system
- code
- occurrence_at
- lot_number
- manufacturer
- organization_id
- note

#### medical_organizations / medical_practitioners

保存医院、诊所、实验室、医生等来源信息。

#### medical_documents

只保存文件元数据：

- id
- profile_id
- title
- document_type
- mime_type
- original_name
- byte_size
- encrypted_object_id
- service_date
- organization_id
- checksum_sha256
- source_type
- source_id
- created_at
- updated_at

#### medical_document_links

允许一个文件关联多个实体：

- document_id
- entity_type
- entity_id
- relation_type

### 5.2 FHIR round-trip 字段

对所有可由 FHIR 导入的主要实体增加：

- `fhir_resource_type`
- `fhir_id`
- `fhir_version_id`
- `fhir_json`
- `source_system`
- `source_record_id`
- `import_batch_id`

这使 LifeTrace 可以在 UI 使用关系表，同时不破坏原始 FHIR 数据。

---

## 6. 安全设计

医疗档案比普通习惯/财务记录敏感，不能默认沿用当前所有数据策略。

### 6.1 当前风险

当前 `lifetrace.db` 是普通 SQLite，连接配置为 WAL / foreign_keys / busy_timeout，并没有数据库级加密。

因此首期不建议把完整病历正文、报告原文、附件直接以明文放入现有通用表。

### 6.2 建议建立 Medical Vault

现有私密相册 Vault 已经具备：

- Argon2id；
- AES-256-GCM；
- wrapped master key；
- 自动锁；
- lock-on-blur；
- 分块加密；
- 完整性验证。

建议把其中的通用密码学和 encrypted object store 抽离成基础设施，而不是让医疗模块依赖“相册”语义。

推荐结构：

```text
crypto/
  keyring.rs
  encrypted_object.rs

vault/
  photo_vault.rs

medical_vault/
  medical_vault.rs
```

医疗附件、原始 FHIR Bundle、扫描件使用 Medical Vault。

结构化字段有两个可选方案：

**A. MVP 推荐：**
- 常用索引字段留在 SQLite；
- 敏感正文/备注/fhir_json 使用 envelope encryption 后存 BLOB；
- 附件全量加密。

**B. 后续增强：**
- 独立 `medical.db` + SQLCipher；
- 医疗 Vault 与数据库共享独立 medical master key。

不要直接把照片 Vault 的 manifest/album 模型拿来存医疗文件。

### 6.3 云同步

Phase 1：

> **医疗档案默认 local-only。**

在后端 contracts、权限、审计、删除语义和敏感数据策略没有完成前：

- 不注册进通用 sync registry；
- 不进入 `sync_outbox`；
- 不发送给云端 AI；
- 不进入远程全文索引。

Phase 3 以后如果要云同步：

- 必须由用户单独开启“同步医疗档案”；
- 医疗 entity type 使用独立 namespace：`medical.*`；
- 明确附件加密方案；
- 加入审计日志；
- 提供彻底删除；
- 后端不得把医疗正文写入普通日志。

---

## 7. 导入能力

### Phase 1

支持：

- 手工录入；
- 拖入 PDF / 图片；
- JSON 备份导入；
- CSV 化验结果导入（模板化）。

### Phase 2

支持：

- FHIR R4 Bundle JSON；
- FHIR NDJSON；
- HealthWallet / Fasten 导出数据适配；
- 通用医疗 PDF 扫描与 OCR。

### Phase 3

可选：

- SMART-on-FHIR；
- 医疗机构 FHIR API；
- Apple Health / Health Connect 等健康数据来源。

第三阶段之前不要把“连接医院账号”作为 MVP 依赖。

---

## 8. 文档 OCR / AI

参考 HealthWallet 的“本地扫描 -> 结构化 FHIR”方向，但 LifeTrace 首期必须保守。

建议流程：

```text
导入 PDF/图片
  -> 原文件加密保存
  -> 本地 OCR
  -> 抽取候选字段
  -> 用户确认
  -> 写入结构化医疗记录
  -> 保留 provenance + 原文件关联
```

AI 只能生成“待确认草稿”，不能静默写入正式病历。

禁止首期自动执行：

- 诊断疾病；
- 推荐停药/换药；
- 自动生成治疗方案；
- 仅基于数值自行判断严重程度。

允许：

- 文档分类；
- 日期/医院/医生提取；
- 检验项目和值提取；
- 药名/剂量文本提取；
- 生成非诊断性的档案摘要。

---

## 9. 与 LifeTrace 其他模块的关系

### 笔记

医疗记录可以创建关联笔记，但默认不复制医疗正文到普通笔记。

关系：

- note.relation -> medical.condition
- note.relation -> medical.encounter
- note.relation -> medical.document

### 日历 / 执行

后续支持从医疗记录创建：

- 复诊提醒；
- 检查提醒；
- 疫苗提醒；
- 用药提醒。

提醒实体只保留必要信息，避免把完整病历复制到执行模块。

### 相册

医疗图片不要作为普通 Photo Asset。

若用户主动选择，可从相册“复制到医疗档案”，复制后的医疗文件进入 Medical Vault 并成为独立对象。

### 全局搜索

首期默认不将医疗正文加入全局搜索。

设置中提供：

- [ ] 在全局搜索中显示医疗档案

开启后也只索引结构化标题/标签，敏感正文搜索优先在 Medical Workspace 内完成。

### AI 助手

首期不把医疗档案自动注入云端 AI 上下文。

未来必须使用显式授权：

> “允许 AI 助手读取本次选中的 3 条医疗记录”

而不是默认可访问整个 Medical Vault。

---

## 10. UI 设计建议

总体继续使用现有 LifeTrace Desktop Workbench，不再挂载独立 WebView。

### 医疗总览

顶部：

- 医疗档案状态；
- 最近更新；
- Medical Vault 锁定状态；
- “新增记录”；
- “导入文件”。

第一行关键卡片：

- 诊断
- 当前用药
- 过敏
- 最近检验

下方：

- 最近医疗时间线；
- 检验趋势；
- 即将到来的复诊/疫苗提醒；
- 最近医疗文件。

### 新增记录

统一 Command Menu：

- 新增就诊
- 新增诊断
- 新增用药
- 新增过敏
- 新增检验
- 新增疫苗
- 新增手术/处置
- 上传医疗文件
- 导入 FHIR

减少为每类实体设计完全不同入口的复杂度。

### 详情抽屉

单条医疗记录建议使用右侧 Detail Drawer：

- 基本信息；
- 来源；
- 关联就诊；
- 关联文件；
- FHIR / provenance；
- 编辑；
- 删除。

不会打断时间线浏览。

---

## 11. 实施阶段

### Phase 0 — 基础设计

- [ ] 确认数据模型与字段；
- [ ] 抽离通用加密 object store；
- [ ] 确认 Medical Vault 锁定策略；
- [ ] 定义 Rust command / frontend API；
- [ ] 定义 migration；
- [ ] 定义测试 fixture；
- [ ] 确定是否支持一个或多个 profile。

### Phase 1 — Local-first 医疗档案 MVP

- [ ] 将 `DesktopHealthModule` 重构为 `HealthWorkspace`；
- [ ] 二级导航；
- [ ] Medical Timeline；
- [ ] Encounter CRUD；
- [ ] Condition CRUD；
- [ ] Medication CRUD；
- [ ] Allergy CRUD；
- [ ] Immunization CRUD；
- [ ] Procedure CRUD；
- [ ] Document CRUD；
- [ ] Medical Vault；
- [ ] 医疗文件预览；
- [ ] migration + repository + IPC；
- [ ] 本地备份与恢复；
- [ ] 单元测试 / Rust 测试。

验收标准：

- 完全离线可用；
- 重启后数据完整；
- 医疗附件磁盘上不是明文；
- 删除记录不遗留孤儿关联；
- 普通全局搜索不会意外泄露医疗正文；
- 普通 cloud sync 不上传医疗实体。

### Phase 2 — 检验与结构化导入

- [ ] DiagnosticReport；
- [ ] Observation；
- [ ] 检验趋势图；
- [ ] 参考区间；
- [ ] FHIR R4 Bundle import；
- [ ] FHIR R4 export；
- [ ] 导入去重；
- [ ] provenance；
- [ ] PDF/图片 OCR；
- [ ] AI 抽取草稿 + 人工确认。

验收标准：

- 同一报告包含多个 Observation；
- 原始 FHIR JSON 可保留；
- import -> export 不丢弃未知字段；
- 重复导入同一来源不会无限生成副本；
- AI 不直接写正式记录。

### Phase 3 — 同步 / 家庭 / 互操作

- [ ] medical.* contracts；
- [ ] opt-in encrypted sync；
- [ ] 多 profile / 家庭成员；
- [ ] IPS export；
- [ ] 医疗数据审计；
- [ ] 彻底删除；
- [ ] provider FHIR connector（可选）。

---

## 12. 测试要求

### Rust

至少覆盖：

- migration；
- repositories；
- referential integrity；
- encrypted object read/write；
- 错误密码；
- tamper detection；
- 删除附件；
- orphan cleanup；
- FHIR import mapper；
- idempotent import；
- backup / restore。

### TypeScript / React

至少覆盖：

- health route；
- timeline filter；
- entity forms；
- lab grouping；
- Medical Vault locked/unlocked state；
- import review；
- privacy mode；
- global search exclusion。

### E2E 验收

准备合成患者 fixture：

- 2 次就诊；
- 3 个诊断；
- 2 个当前用药；
- 1 个过敏；
- 2 份化验单；
- 10+ Observation；
- 1 次疫苗；
- 1 次手术；
- 3 个 PDF/图片附件。

不能使用真实用户病历作为测试 fixture。

---

## 13. 推荐优先级

LifeTrace 的第一版医疗档案建议只做四件事，并把它们做好：

1. **医疗时间线**
2. **疾病 / 用药 / 过敏**
3. **检验结果 + 趋势**
4. **加密医疗文档**

不要一开始就做医院连接、智能诊断或复杂 FHIR Server。

这样既能马上解决“个人历史病历集中保存”的核心需求，也与 LifeTrace 已有的 local-first 桌面架构保持一致。

---

## 14. 推荐技术决策

最终建议：

- 产品模型：参考 **HealthWallet.me + Fasten**；
- 医疗数据关系模型：参考 **FHIR R4 + OpenMRS**；
- FHIR 工程实现：参考 **Medplum**；
- UI 保持 LifeTrace 原生桌面 Workbench；
- `/app/health` 升级，不增加新的一级“医疗”入口；
- typed SQLite schema，不把业务全部存成 JSON；
- 原始 FHIR 数据作为 round-trip/provenance 保存；
- Medical Vault 使用现有 AES-256-GCM / Argon2id 能力抽象后的通用加密层；
- Phase 1 医疗数据默认 **local-only**；
- AI/OCR 只生成需要用户确认的结构化草稿；
- 医疗模块不提供诊断或治疗建议。

这条路线能最大程度复用 LifeTrace 当前基础设施，同时避免医疗数据过早进入现有通用同步、搜索和 AI 通道。

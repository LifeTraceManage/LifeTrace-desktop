# LifeTrace Desktop 医疗检查记录规划

> 状态：Scope Revised / Proposal  
> 范围：只管理个人每次医疗检查及检查结果；**不做完整病历系统**。  
> 仓库：`LifeTraceManage/LifeTrace-desktop`  
> 入口：复用现有 `/app/health`，不新增一级导航。  
> 产品主线：**一次检查 → 一条记录 → 多份报告附件 / 多个指标（可选） → 历史查看与比较。**

## 1. 需求边界

### 1.1 要解决的事情

- 去医院做完体检、血液化验、影像、专项检查后，能快速保存一条记录；
- 记录检查日期、项目名称、医疗机构、结果摘要与备注；
- 把拿到的 PDF、图片、扫描件归档到同一次检查；
- 按时间查看所有历史检查；
- 需要时搜索“某次体检 / 某个检验项目 / 某家医院”；
- 对反复检查的同一个数值指标，**可选**录入结果并查看历史变化；
- 离线可访问，能备份和恢复，记录不会因删除原始附件而意外丢失。

### 1.2 明确不做

- 疾病诊断台账、慢病管理；
- 处方和用药管理；
- 过敏、疫苗、手术历史管理；
- 医院 HIS/EMR 功能；
- 医生工作流、医院账户接入；
- 家庭成员多档案；
- 把检查结果交给云端 AI 自动诊断；
- 初期不引入完整 FHIR Server 或大规模 FHIR 资源模型。

**使用目标是“保存和回看自己的每次医疗检查”，而不是创建医院电子病历。**

## 2. 合适的开源参考

本需求比完整的个人健康档案（PHR）简单。按此范围，优先参考小型检查/化验跟踪项目。

| 项目 | 地址 | 参考重点 | 取舍 |
| --- | --- | --- | --- |
| **Soma** | https://github.com/mdportnov/soma | **Tauri + React + SQLite** 的本地桌面健康时间线、检验 PDF/图片导入、指标趋势、导出与备份 | 与 LifeTrace 技术栈相近，优先参考其检查结果体验，不引入药物等功能；MIT 许可 |
| **Vitametr** | https://github.com/ACiDekCZ/vitametr | 按日期录入一组检测值、结果趋势图、单位/参考区间、离线保存 | 数据模型与数值对比方向；MPL-2.0 |
| **Bloodboy** | https://github.com/ashugaev/bloodboy-biomarkers-tracker | 检验报告 PDF 预览、指标录入/提取、趋势图、导出 | 重点参考“报告+指标”交互；AGPL-3.0，不直接复制代码 |
| **Fasten OnPrem** | https://github.com/fastenhealth/fasten-onprem | 历史检查、化验报告分组与 Observation 曲线 | 范围过大，且原仓库已归档，仅作产品参考 |

**不再以 HealthWallet / Medplum / OpenMRS / OpenEMR 为主要实现基线**；这些主要用于完整 PHR/EMR/FHIR，超出当前需求。开源项目仅借鉴产品思路；复用源码必须独立核查许可证与第三方依赖。

## 3. 使用场景

### 场景 A：做了一次普通体检

1. 点击“新增检查”；
2. 选择检查日期、类型（体检）、填“年度体检”；
3. 填机构名称（可空）；
4. 上传 PDF 体检报告或拍照；
5. 写一句备注：“每年单位体检”；
6. 保存。

这就是一条完整有效的检查记录。**不强制录入报告内每个数字。**

### 场景 B：去医院做了血常规 / 肝功能

1. 创建一次“血液检验”记录；
2. 上传报告；
3. 若希望长期比较，录入部分关键指标：名称、结果、单位、报告参考范围；
4. 以后再次做同类检查时，可在某指标下查看历次值。

### 场景 C：做了胸部 CT / 超声 / 心电图

1. 创建“影像/专项检查”记录；
2. 保存检查名称、日期、机构；
3. 上传影像检查报告 PDF/图片；
4. 可选填写原始报告中的结论文本；
5. 不要求数值结果或诊断模型。

## 4. 产品交互

复用左侧 `成长健康 → 健康`。

### 4.1 页面设计

保留现有 `/app/health` 入口，不增加一级模块。

健康工作区内部可以使用两个页签：

- **检查记录（默认）**：按日期倒序排列；
- **指标趋势（后续启用）**：对反复检查的相同项目作历史对比。

现有健康概览的习惯、训练、情绪指标保留为辅助内容或独立的“日常健康”页签，不把这些数据混入医疗检查记录。

### 4.2 检查列表

每条卡片/表格行展示：

- 检查日期；
- 检查名称（例如“2026 年度体检”“血常规”“腹部超声”）；
- 检查类型；
- 医院/机构（可选）；
- 附件数量；
- 一行结果摘要（可选）。

交互：

- “+ 新增检查”；
- 按年份、类型、机构筛选；
- 关键词搜索；
- 单击打开详情；
- 编辑、删除（带确认）。

### 4.3 新建/编辑检查

**必填：**

- 检查日期 `exam_date`
- 检查名称 `title`

**可选：**

- 类型 `exam_type`：常规体检、血液检验、尿液检验、影像检查、心电/超声、其他；
- 医疗机构 `organization_name`；
- 科室 `department`；
- 结果摘要 `result_summary`；
- 个人备注 `notes`；
- 报告附件（0 到多份）。

可选类型只是分类工具，支持用户自定义名称。草稿内容不可因附件上传失败而丢失。

### 4.4 检查详情

布局建议：

左/上：检查基本信息 + 原始报告结论 + 备注。  
右/下：报告附件列表、PDF/图片预览。  
后续：这次检查中录入的指标值列表。

**同一次检查可以包含多份附件和多个检验指标。**

### 4.5 指标趋势（Phase 2）

例：空腹血糖、糖化血红蛋白、总胆固醇、ALT 等。

每条指标值含：

- 指标名称；
- 结果数值 / 文本结果；
- 单位；
- 参考范围（来自该次报告，可空）；
- 采样/检测日期（缺省为检查日期）；
- 关联的检查记录。

规则：

- 只对单位一致、含义一致的数值绘制同一趋势；
- 不静默换算单位；
- 不由前端自行给出临床诊断；
- 参考区间必须按**当次报告**存档，不假定所有医院/时段统一；
- 报告内标为高/低/异常的结果可以原样展示，但应清楚注明“源自报告”。

## 5. 建议的数据结构

MVP 仅需两个主要表；启用趋势时加入第三张表。

### 5.1 `medical_exams`

```text
id                  TEXT PRIMARY KEY
user_id             TEXT NOT NULL
exam_date           TEXT NOT NULL
title               TEXT NOT NULL
exam_type           TEXT NOT NULL DEFAULT 'other'
organization_name   TEXT
department          TEXT
result_summary      TEXT
notes               TEXT
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
deleted_at          TEXT
```

### 5.2 `medical_exam_attachments`

```text
id                  TEXT PRIMARY KEY
exam_id             TEXT NOT NULL REFERENCES medical_exams(id)
display_name        TEXT NOT NULL
original_filename   TEXT NOT NULL
mime_type           TEXT NOT NULL
byte_size           INTEGER NOT NULL
encrypted_object_id TEXT NOT NULL
sha256              TEXT NOT NULL
created_at          TEXT NOT NULL
```

上传原文件只保存一份加密副本，保留原始文件名和校验值；数据库只存加密对象引用，不存文件绝对路径或 base64 正文。预览必须通过受控的 Tauri 读取接口，而非静态公开目录。

### 5.3 `medical_exam_results`（第二阶段）

```text
id                  TEXT PRIMARY KEY
exam_id             TEXT NOT NULL REFERENCES medical_exams(id)
metric_key          TEXT
metric_name         TEXT NOT NULL
value_number        REAL
value_text          TEXT
unit                TEXT
reference_low       REAL
reference_high      REAL
reference_text      TEXT
source_flag         TEXT
measured_at         TEXT
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
```

`metric_key` 可用于用户确认同一种指标的历史串联；未映射的指标仍然可以保存。不要为了做趋势提前维护庞大的医学术语目录。

实现时检查复合索引：`(user_id, exam_date)`、`(exam_id)`、`(metric_key, measured_at)`。单用户主档案已足够，不需要单独的 `Patient`/`Encounter`/`Condition` 等 FHIR 表。

## 6. 与当前 LifeTrace 代码的接入

已核实当前架构：

- `src/components/DesktopWorkbenchShell.tsx` 中已有 `/app/health`；
- `src/components/DesktopNativeRouteContent.tsx` 将它映射到 `DesktopHealthModule`；
- `src/components/DesktopHealthModule.tsx` 当前是坚持、训练、复盘的概览；
- `tauri-ui/main.tsx` 启动原生桌面 React 工作台；
- Rust 侧通过 `commands` + `application` + `database/repositories` 管理本机数据；
- 已具备迁移、备份、私密相册 Vault；但主数据库连接当前没有启用数据库级加密。

建议文件结构：

```text
src/components/feature/health/
  HealthWorkspace.tsx
  ExamList.tsx
  ExamForm.tsx
  ExamDetail.tsx
  ExamAttachmentViewer.tsx
  ExamMetricTrends.tsx            # Phase 2

src/services/medicalExamApi.ts
src/types/medicalExam.ts

src-tauri/src/
  commands/medical_exam.rs
  application/medical_exam.rs
  database/repositories/medical_exam.rs
```

仅把医疗检查记录挂在健康工作区内；**不添加完整医疗档案体系**。可复用公共列表、表单、预览、日期选择等组件，不再新建 MedicalTimeline / Conditions / Medications 等大量页面。

### 6.1 IPC

提供有边界的命令：

- `medical_exam_list` / `medical_exam_get`
- `medical_exam_save` / `medical_exam_delete`
- `medical_exam_attachment_import`
- `medical_exam_attachment_read`
- `medical_exam_attachment_delete`
- Phase 2：`medical_exam_result_save` / `medical_exam_result_list`

按当前 profile/user_id 验证所有访问，检查附件归属，防路径遍历；写入操作走数据库事务，失败须保留已存在数据。

## 7. 隐私、存储与备份

医疗检查报告是敏感数据，不能直接当作普通相册资源或公共同步文件。

- **MVP 默认 local-only**，不进入通用云同步、云端 AI、普通全局搜索；
- 附件建议复用独立抽象的加密对象存储，不直接依赖私密相册的“相册/照片”语义；
- 对检查结论、备注等敏感文本提供加密存储边界；不能误认为普通 `lifetrace.db` 已加密；
- 医疗数据只有在解锁后才能查看和导出；
- 锁屏/锁定后清除附件预览内存与临时文件；
- 导出的备份必须加密并支持恢复验证；
- 删除检查时同时处理附件引用和物理加密对象，避免孤儿文件；
- 不在日志、崩溃报告、分析事件里记录医疗正文和附件内容。

首期不开发云同步；将来如需跨设备同步，再单独确定加密、授权与后端协议。

## 8. 分阶段实施

### Phase 1 — 最小可用版（首要目标）

- [ ] 将当前健康模块增加“检查记录”主视图，保留已有健康概览能力；
- [ ] 按时间倒序列出检查记录；
- [ ] 新建 / 编辑 / 删除检查；
- [ ] 检查类型、日期、医院、结果摘要、备注；
- [ ] PDF 和图片上传、预览、下载；
- [ ] 每次检查绑定多份附件；
- [ ] 按时间、类型、医院筛选和关键词搜索；
- [ ] Rust repository / IPC / migration；
- [ ] 加密存储和本地备份/恢复；
- [ ] 单元测试、Rust 测试、桌面端手工验收。

**交付后已经可以把每一次检查与原始报告完整记录下来。**

### Phase 2 — 可选的检验结果比较

- [ ] 每次检查下手工添加多条指标；
- [ ] 查看同一指标的历次值；
- [ ] 趋势图；
- [ ] 按来源报告记录单位、参考区间；
- [ ] 导出 CSV/JSON；
- [ ] 异常值仅依来源报告展示；
- [ ] 增量测试覆盖不同单位/不同参考范围的情况。

### Phase 3 — 可选的省力功能（不作为首版前提）

- [ ] 本地 OCR 提取报告里的日期、医院和项目；
- [ ] 批量识别体检单中的数值；
- [ ] 用户逐项审核后再保存；
- [ ] PDF 批量导入、去重；
- [ ] 如确有需要再研究 FHIR 数据导入。

除非另行提出，**不扩展到处方、诊疗建议、医生预约或完整病历系统**。

## 9. 验收标准

### Phase 1 必须通过

1. 完全断网仍可创建、查看、编辑检查；
2. 仅凭检查日期和名称，即可创建记录；其他字段全部可选；
3. 可以关联多个 PDF/图片，并正确查看、下载；
4. 退出重启后检查记录与附件均存在；
5. 附件删除和检查删除均不会误删其他检查的文件；
6. 医疗附件落盘为加密数据，不泄露在系统临时目录；
7. 未经授权无法跨 profile 读取；
8. 通用云同步、普通全局搜索、AI 助手不会意外读取或上传医疗正文；
9. 能安全导出并恢复备份；
10. 运行 `npm run lint`、`npm run test:unit`、`npm run web:build`、`npm run test:rust`，并用合成 PDF/图片夹具进行检查记录 CRUD 和附件验收。

### Phase 2 必须通过

- 同一次检查可录入多个检测值；
- 不同日期同一检测项可形成时间序列；
- 文字结果（如“阴性”）不被强制画成数值；
- 单位不兼容时不拼接趋势线；
- 原始检查报告保留，修改指标不会修改原文件。

## 10. 结论

本次需求不是开发“个人医疗系统”，而是开发 **个人医疗检查记录本**。

**首版只需要做到：新增一次检查、保存日期和检查内容、上传报告、随时查阅历史。**

指标趋势属于第二阶段；OCR、FHIR 等全部为可选增强。不要为了以后可能需要的复杂功能拖慢首版开发。

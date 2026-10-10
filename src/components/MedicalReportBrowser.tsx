import { useEffect, useState } from "react";
import { FileImage, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { open as chooseDirectory } from "@tauri-apps/plugin-dialog";
import {
  medicalReportApi,
  type MedicalAssetData,
  type MedicalListItem,
  type MedicalReportDetail,
  type MedicalMetricHistoryPoint,
  type MedicalReportRevision,
} from "@/src/services/medicalReportApi";

/** Read-only archive. New reports are intentionally added through the cloud Agent. */
export default function MedicalReportBrowser() {
  const [items, setItems] = useState<MedicalListItem[]>([]);
  const [selected, setSelected] = useState<MedicalReportDetail | null>(null);
  const [preview, setPreview] = useState<MedicalAssetData | null>(null);
  const [revisions, setRevisions] = useState<MedicalReportRevision[] | null>(null);
  const [trend, setTrend] = useState<{
    name: string; unit: string; points: MedicalMetricHistoryPoint[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState("");
  const [filter, setFilter] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    try {
      setItems(await medicalReportApi.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取本地医疗检查");
    } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const open = async (id: string) => {
    setError("");
    setPreview(null);
    setTrend(null);
    setRevisions(null);
    try { setSelected(await medicalReportApi.detail(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取报告详情"); }
  };
  const loadRevisions = async (reportId: string) => {
    setError("");
    try { setRevisions(await medicalReportApi.listRevisions(reportId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取历史修订"); }
  };
  const openAsset = async (id: string) => {
    setError("");
    try { setPreview(await medicalReportApi.readAsset(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取原始图片"); }
  };
  const openTrend = async (name: string, unit: string) => {
    setError("");
    try {
      const points = await medicalReportApi.metricHistory(name, unit);
      setTrend({ name, unit, points });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取历史检验数据");
    }
  };
  const auditArchive = async () => {
    if (auditing || backupBusy) return;
    setAuditing(true);
    setError("");
    setAuditResult("");
    try {
      const result = await medicalReportApi.verifyArchive();
      const problems = result.missingFiles + result.corruptFiles + result.orphanFiles;
      setAuditResult("检查了 " + result.checkedReports + " 份报告、" + result.checkedFiles +
        " 份原件；缺失 " + result.missingFiles + "、校验失败 " + result.corruptFiles +
        "、未关联文件 " + result.orphanFiles +
        (problems ? "。没有自动删除或更改任何文件，请核对原始资料或备份。" : "。文件完整性正常。"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法检查医疗原件完整性");
    } finally {
      setAuditing(false);
    }
  };
  const backupAction = async (action: "export" | "import") => {
    if (backupBusy) return;
    if (!window.confirm(action === "export"
      ? "即将备份当前账号的医疗检查和原始图片。备份不会加密，其他有文件权限的程序可读取，是否继续？"
      : "即将从备份目录恢复医疗档案。会先校验每份原件，遇到与现有档案重复的文件则中止，不覆盖当前记录。是否继续？")) return;
    setBackupBusy(true);
    setError("");
    setBackupStatus("");
    try {
      const directory = await chooseDirectory({ directory: true, multiple: false,
        title: action === "export" ? "选择医疗报告备份保存位置" : "选择包含 manifest.json 的医疗档案备份文件夹" });
      if (typeof directory !== "string") return;
      const result = action === "export"
        ? await medicalReportApi.exportBackup(directory)
        : await medicalReportApi.importBackup(directory);
      setBackupStatus((action === "export" ? "备份完成：" : "恢复完成：") +
        result.reports + " 份报告、" + result.files + " 份原始文件。路径：" + result.path);
      if (action === "import") await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "医疗档案备份或恢复失败");
    } finally {
      setBackupBusy(false);
    }
  };
  const visible = items.filter((item) => [item.title, item.facility || "", item.examAt || "", item.reportType]
    .join(" ").toLocaleLowerCase().includes(filter.toLocaleLowerCase()));

  return <article className="hx-panel">
    <header className="hx-panel-head">
      <div><span className="hx-kicker">医疗检查</span><h2>报告归档</h2></div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={busy || backupBusy || auditing} onClick={() => void auditArchive()}>检查原件</button>
        <button type="button" disabled={busy || backupBusy || auditing} onClick={() => void backupAction("export")}>备份</button>
        <button type="button" disabled={busy || backupBusy || auditing} onClick={() => void backupAction("import")}>恢复</button>
        <button type="button" title="刷新医疗检查" disabled={busy || backupBusy} onClick={() => void load()}><RefreshCw/></button>
      </div>
    </header>
    <div className="hx-panel-body">
      <p>在「Agent」中发送医疗报告图片即可识别和归档；此处只负责查看记录和原始文件。医疗资料保存在本机普通文件与 SQLite 中，未加密。</p>
      <input aria-label="搜索检查报告" placeholder="搜索检查名称、医院或日期"
        value={filter} onChange={(event) => setFilter(event.target.value)}
        style={{ padding: 8, width: "100%", borderRadius: 6 }}/>
      {error ? <p role="alert">{error}</p> : null}
      {backupStatus ? <p role="status" style={{ overflowWrap: "anywhere" }}>{backupStatus}</p> : null}
      {auditResult ? <p role="status">{auditResult}</p> : null}
      {busy ? <p><LoaderCircle className="spin"/>加载检查记录…</p> : null}
      {!busy && visible.length === 0 ? <p>没有匹配的检查记录。请在 Agent 对话中上传报告照片。</p> : null}
      {visible.map((item) => <button key={item.id} type="button" onClick={() => void open(item.id)}
        className="hx-history-row" style={{ width: "100%", textAlign: "left", cursor: "pointer" }}>
        <span>{item.examAt || "日期未知"}</span>
        <div><strong>{item.title}</strong><small>{item.facility || item.reportType} · {item.observationCount} 项结果 · {item.attachmentCount} 张原图</small></div>
        <FileText/>
      </button>)}
      {selected ? <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <h3>{selected.report.title}</h3>
          <button type="button" onClick={() => { setSelected(null); setPreview(null); setTrend(null); setRevisions(null); }}>关闭详情</button>
        </div>
        <p>{selected.report.examAt || selected.report.issuedAt || "日期未知"} · {selected.report.facility || "医疗机构未知"} · {selected.report.reportType}</p>
        {selected.report.sections?.map((section, index) =>
          <section key={index} style={{ marginTop: 10 }}>
            <strong>{section.titleRaw || section.kind}</strong>
            <p style={{ whiteSpace: "pre-wrap" }}>{section.textRaw}</p>
          </section>)}
        {selected.report.observations?.length ? <div style={{ maxHeight: 340, overflow: "auto" }}>
          <h4>检查结果（{selected.report.observations.length} 项）</h4>
          <table style={{ width: "100%", fontSize: 12 }}>
            <thead><tr><th>项目</th><th>结果</th><th>单位</th><th>参考范围</th><th>标记</th><th>证据</th></tr></thead>
            <tbody>{selected.report.observations.map((value, index) =>
              <tr key={index}>
                <td>{typeof value.valueNumber === "number" ?
                  <button type="button" title="查看该指标的历次检测值" onClick={() => void openTrend(value.nameRaw, value.unitRaw || "")}>
                    {value.nameRaw}
                  </button> : value.nameRaw}</td>
                <td>{value.valueRaw}</td><td>{value.unitRaw || "—"}</td>
                <td>{value.referenceRangeRaw || "—"}</td><td>{value.sourceFlag || "—"}</td>
                <td><button type="button" title="查看该检测值对应的原始报告"
                  onClick={() => void openAsset(value.sourceAssetId)}>查看原图</button></td>
              </tr>)}</tbody>
          </table>
        </div> : null}
        {trend ? <section aria-label="检验指标历史趋势" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{trend.name} · 历次检测</strong>
            <button type="button" onClick={() => setTrend(null)}>关闭趋势</button>
          </div>
          <small>只比较同名、同单位、有实际检查日期的数值。不同检验方法与参考范围仍需结合原报告核对。</small>
          {trend.points.length ? <>
            <svg viewBox="0 0 560 160" role="img" aria-label={trend.name + " 历次检测值"}
              style={{ width: "100%", maxHeight: 200 }}>
              {(() => {
                const numbers = trend.points.map((point) => point.valueNumber);
                const min = Math.min(...numbers), max = Math.max(...numbers);
                const span = Math.max(1, max - min);
                const coords = trend.points.map((point, index) => ({
                  x: 35 + index * 485 / Math.max(1, trend.points.length - 1),
                  y: 125 - (point.valueNumber - min) * 90 / span,
                  point,
                }));
                return <>
                  <line x1="35" y1="125" x2="525" y2="125" stroke="currentColor" opacity="0.4"/>
                  <polyline fill="none" stroke="currentColor" strokeWidth="2"
                    points={coords.map(({ x, y }) => x + "," + y).join(" ")}/>
                  {coords.map(({ x, y, point }, index) => <g key={index}>
                    <circle cx={x} cy={y} r="4" fill="currentColor"/>
                    <text x={x} y={Math.max(14, y - 12)} textAnchor="middle" fontSize="11" fill="currentColor">
                      {point.valueNumber}
                    </text>
                    <text x={x} y="148" textAnchor="middle" fontSize="10" fill="currentColor">
                      {point.examAt.slice(2)}
                    </text>
                  </g>)}
                </>;
              })()}
            </svg>
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {trend.points.map((point) => <p key={point.reportId + point.examAt} style={{ fontSize: 12 }}>
                {point.examAt} · {point.valueNumber} {point.unitRaw} · {point.reportTitle}
              </p>)}
            </div>
          </> : <p>没有可以比较的历史数值。</p>}
        </section> : null}
        <div style={{ marginTop: 14 }}>
          <button type="button" onClick={() => void loadRevisions(selected.id)}>查看修订历史</button>
          {revisions ? <details open style={{ padding: 8 }}>
            <summary>报告修订版本（{revisions.length} 条）</summary>
            {!revisions.length ? <p>此报告尚未修订。</p> : revisions.map((revision) => <details key={revision.id} style={{ marginTop: 8 }}>
              <summary>{new Date(revision.changedAt).toLocaleString("zh-CN")} · {revision.previous.title} → {revision.updated.title}</summary>
              <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 12 }}>
                <strong>修订前的结构化结果</strong>
                {revision.previous.observations?.map((item, index) => <p key={index}>
                  {item.nameRaw}：{item.valueRaw} {item.unitRaw || ""}
                </p>)}
              </div>
            </details>)}
          </details> : null}
        </div>
        <h4>原始报告图片</h4>
        {selected.assets.map((asset) => <button type="button" key={asset.id}
          onClick={() => void openAsset(asset.id)}
          style={{ marginRight: 8, marginBottom: 8 }}>
          <FileImage style={{ width: 15 }}/> {asset.originalName}
        </button>)}
        {preview ? <figure>
          <img alt={preview.originalName} src={"data:" + preview.mimeType + ";base64," + preview.base64}
            style={{ display: "block", maxHeight: 600, maxWidth: "100%", objectFit: "contain" }}/>
          <figcaption>{preview.originalName}</figcaption>
        </figure> : null}
      </div> : null}
    </div>
  </article>;
}

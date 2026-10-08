import { useEffect, useState } from "react";
import { FileImage, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import {
  medicalReportApi,
  type MedicalAssetData,
  type MedicalListItem,
  type MedicalReportDetail,
} from "@/src/services/medicalReportApi";

/** Read-only archive. New reports are intentionally added through the cloud Agent. */
export default function MedicalReportBrowser() {
  const [items, setItems] = useState<MedicalListItem[]>([]);
  const [selected, setSelected] = useState<MedicalReportDetail | null>(null);
  const [preview, setPreview] = useState<MedicalAssetData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    try { setSelected(await medicalReportApi.detail(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取报告详情"); }
  };
  const openAsset = async (id: string) => {
    setError("");
    try { setPreview(await medicalReportApi.readAsset(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取原始图片"); }
  };
  const visible = items.filter((item) => [item.title, item.facility || "", item.examAt || "", item.reportType]
    .join(" ").toLocaleLowerCase().includes(filter.toLocaleLowerCase()));

  return <article className="hx-panel">
    <header className="hx-panel-head">
      <div><span className="hx-kicker">医疗检查</span><h2>报告归档</h2></div>
      <button type="button" title="刷新医疗检查" disabled={busy} onClick={() => void load()}><RefreshCw/></button>
    </header>
    <div className="hx-panel-body">
      <p>在「Agent」中发送医疗报告照片即可识别和归档；此处只负责查看记录和原始文件。医疗资料保存在本机普通文件与 SQLite 中，未加密。</p>
      <input aria-label="搜索检查报告" placeholder="搜索检查名称、医院或日期"
        value={filter} onChange={(event) => setFilter(event.target.value)}
        style={{ padding: 8, width: "100%", borderRadius: 6 }}/>
      {error ? <p role="alert">{error}</p> : null}
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
          <button type="button" onClick={() => { setSelected(null); setPreview(null); }}>关闭详情</button>
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
            <thead><tr><th>项目</th><th>结果</th><th>单位</th><th>参考范围</th><th>标记</th></tr></thead>
            <tbody>{selected.report.observations.map((value, index) =>
              <tr key={index}>
                <td>{value.nameRaw}</td><td>{value.valueRaw}</td><td>{value.unitRaw || "—"}</td>
                <td>{value.referenceRangeRaw || "—"}</td><td>{value.sourceFlag || "—"}</td>
              </tr>)}</tbody>
          </table>
        </div> : null}
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

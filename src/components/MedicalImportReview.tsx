import type { MedicalExtractReply, MedicalImageInput } from "@/src/services/medicalReportApi";
import { AlertTriangle, Check, FileText, RefreshCw, X } from "lucide-react";

type Props = {
  draft: MedicalExtractReply;
  images: MedicalImageInput[];
  disabled: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
  onReextract: () => void;
  correction: string;
};

/** Review happens locally, never in persistent cloud Agent messages. */
export default function MedicalImportReview({ draft, images, disabled, onConfirm, onDiscard, onReextract, correction }: Props) {
  return <section className="lt-cloud-agent-approvals" aria-label="医疗检查报告归档预览">
    <header><FileText/><strong>检查报告识别结果 · 待确认归档</strong></header>
    <p>以下内容由视觉模型直接从图片提取，可能存在遗漏或识别错误。请对照原报告核对后再保存。</p>
    {draft.groupingWarnings.length ? <div role="alert">
      <AlertTriangle/> {draft.groupingWarnings.join("；")}
    </div> : null}
    {draft.reports.map((report, index) => <article key={index}>
      <div style={{ width: "100%", minWidth: 0 }}>
        <strong>{report.title}</strong>
        <small>{report.examAt || report.issuedAt || "日期未识别"} · {report.facility || "医疗机构未知"} · {report.reportType} · {report.sourceAssetIds.length} 张原图</small>
        {report.reviewReasons?.length ? <p role="alert">待核对：{report.reviewReasons.join("；")}</p> : null}
        <details>
          <summary>查看对应原始报告图片（{report.sourceAssetIds.length} 张）</summary>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
            {images.filter((img) => report.sourceAssetIds.includes(img.assetId)).map((img) =>
              <figure key={img.assetId} style={{ margin: 0, minWidth: 0 }}>
                <img src={"data:" + img.mimeType + ";base64," + img.base64}
                  alt={img.originalName}
                  style={{ width: "100%", maxHeight: "560px", objectFit: "contain", borderRadius: 6 }}/>
                <figcaption style={{ fontSize: 12, overflowWrap: "anywhere" }}>{img.originalName}</figcaption>
              </figure>)}
          </div>
        </details>
        {report.sections.map((section, j) => <details key={j} open={j === 0}>
          <summary>{section.titleRaw || section.kind}</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{section.textRaw}</p>
        </details>)}
        {report.observations.length ? <details open>
          <summary>结构化检查结果（{report.observations.length} 项）</summary>
          <div style={{ overflowX: "auto", maxHeight: "260px", overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr><th>项目</th><th>结果</th><th>单位</th><th>参考范围</th><th>标记</th></tr></thead>
              <tbody>{report.observations.map((row, j) => <tr key={j}>
                <td>{row.nameRaw}</td><td>{row.valueRaw}</td>
                <td>{row.unitRaw || "—"}</td><td>{row.referenceRangeRaw || "—"}</td><td>{row.sourceFlag || "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details> : null}
      </div>
    </article>)}
    <div style={{ display: "flex", justifyContent: "end", gap: 10 }}>
      <button type="button" className="secondary" disabled={disabled || !correction.trim()} onClick={onReextract}><RefreshCw/>按说明重新识别</button>
      <button type="button" className="secondary" disabled={disabled} onClick={onDiscard}><X/>丢弃草稿</button>
      <button type="button" className="primary" disabled={disabled} onClick={onConfirm}><Check/>确认归档到本机</button>
    </div>
    <small>识别有误时，在下方对话输入更正说明，再点击“按说明重新识别”；会重新发送本批报告图片。确认后医疗数据和原图保存在本机普通文件与 SQLite，不加密、不进行常规云同步。</small>
  </section>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  Cloud,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  cloudAgentApi,
  type CloudAgentApproval,
  type CloudAgentMessage,
  type CloudAgentSession,
} from "@/src/services/cloudAgentApi";
import MedicalImportReview from "@/src/components/MedicalImportReview";
import {
  medicalReportApi, type MedicalImageInput, type MedicalExtractReply,
} from "@/src/services/medicalReportApi";

type PendingMedicalDraft = {
  result: MedicalExtractReply;
  images: MedicalImageInput[];
  idempotencyKey: string;
};
const ACCEPTED_MEDICAL_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);
function fileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string" || !value.includes(",")) {
        reject(new Error("图片读取失败"));
      } else {
        resolve(value.slice(value.indexOf(",") + 1));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}
function validateFiles(files: File[]): void {
  if (!files.length || files.length > 8) throw new Error("一次最多上传 8 张报告图片");
  if (files.some((file) => !ACCEPTED_MEDICAL_IMAGES.has(file.type))) {
    throw new Error("目前支持 JPG、PNG 和 WebP 图片，PDF 将在后续版本支持");
  }
  if (files.some((file) => file.size > 5 * 1024 * 1024) ||
      files.reduce((sum, file) => sum + file.size, 0) > 12 * 1024 * 1024) {
    throw new Error("单张图片最大 5 MiB，每批不超过 12 MiB");
  }
}

type VisibleMessage = Pick<CloudAgentMessage, "id" | "role" | "content" | "provider">;

function displayMessages(items: CloudAgentMessage[]): VisibleMessage[] {
  return items.filter((item) => item.role === "user" || item.role === "assistant");
}

function sessionStamp(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function CloudAgentModule() {
  const [sessions, setSessions] = useState<CloudAgentSession[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<VisibleMessage[]>([]);
  const [approvals, setApprovals] = useState<CloudAgentApproval[]>([]);
  const [input, setInput] = useState("");
  const [reportFiles, setReportFiles] = useState<File[]>([]);
  const [medicalDraft, setMedicalDraft] = useState<PendingMedicalDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === sessionId) ?? null,
    [sessionId, sessions],
  );

  const refreshSessions = async () => {
    const items = await cloudAgentApi.listSessions();
    setSessions(items);
    return items;
  };

  useEffect(() => {
    let active = true;
    void refreshSessions()
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法加载云端 Agent 会话");
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, loading, medicalDraft]);

  const openSession = async (id: string) => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const [nextMessages, nextApprovals] = await Promise.all([
        cloudAgentApi.listMessages(id),
        cloudAgentApi.listApprovals(id),
      ]);
      setSessionId(id);
      setMessages(displayMessages(nextMessages));
      setApprovals(nextApprovals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "会话加载失败");
    } finally {
      setLoading(false);
    }
  };

  const newSession = () => {
    if (loading) return;
    setSessionId("");
    setMessages([]);
    setApprovals([]);
    setInput("");
    setReportFiles([]);
    setMedicalDraft(null);
    setError("");
  };

  const removeSession = async (id: string) => {
    if (loading || !window.confirm("删除这条云端 Agent 会话？")) return;
    setLoading(true);
    setError("");
    try {
      await cloudAgentApi.deleteSession(id);
      const next = await refreshSessions();
      if (sessionId === id) {
        setSessionId("");
        setMessages([]);
        setApprovals([]);
      }
      setSessions(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "会话删除失败");
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const prompt = input.trim();
    if (loading || (!prompt && !reportFiles.length)) return;
    if (medicalDraft) {
      await reextractMedical(prompt);
      return;
    }
    if (reportFiles.length) {
      const imagesToSend = reportFiles;
      try {
        validateFiles(imagesToSend);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "检查报告附件不符合限制");
        return;
      }
      if (!window.confirm("医疗报告包含隐私信息。是否允许将这些图片临时发送给 LifeTrace-cloud 和配置的视觉模型服务进行识别？识别后将以未加密的形式保存在本机。")) return;
      setError("");
      setLoading(true);
      try {
        const images = await Promise.all(imagesToSend.map(async (file) => ({
          assetId: crypto.randomUUID(),
          originalName: file.name,
          mimeType: file.type,
          base64: await fileData(file),
        })));
        const duplicates = await medicalReportApi.checkDuplicates(images);
        if (duplicates.length) {
          const existing = duplicates.map((item) => item.existingTitle || "已有归档文件")
            .filter((item, index, all) => all.indexOf(item) === index);
          throw new Error(`检测到 ${duplicates.length} 张已归档的相同原始图片（${existing.join("、")}），请勿重复导入。需要更正时请使用原记录。`);
        }
        const result = await cloudAgentApi.extractMedicalReports(images, prompt);
        setReportFiles([]);
        setInput("");
        setMedicalDraft({ result, images, idempotencyKey: crypto.randomUUID() });
        setMessages((current) => [...current, {
          id: crypto.randomUUID(), role: "user",
          content: `提交了 ${images.length} 张医疗报告图片进行识别${prompt ? `；附带说明：${prompt}` : ""}（图片内容不保存到云端会话）。`,
        }]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "医疗检查报告识别失败");
      } finally {
        setLoading(false);
      }
      return;
    }
    setInput("");
    setError("");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: prompt },
    ]);
    setLoading(true);
    try {
      const reply = await cloudAgentApi.ask(prompt, sessionId || null);
      setSessionId(reply.sessionId);
      setMessages((current) => [
        ...current,
        {
          id: reply.runId,
          role: "assistant",
          content: reply.reply,
          provider: reply.provider,
        },
      ]);
      const [nextSessions, nextApprovals] = await Promise.all([
        refreshSessions(),
        cloudAgentApi.listApprovals(reply.sessionId),
      ]);
      setSessions(nextSessions);
      setApprovals(nextApprovals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "云端 Agent 暂时无法回答");
    } finally {
      setLoading(false);
    }
  };

  const reextractMedical = async (instruction: string) => {
    if (!medicalDraft || loading || !instruction.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await cloudAgentApi.extractMedicalReports(medicalDraft.images, instruction);
      setMedicalDraft((current) => current ? { ...current, result } : current);
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "user",
        content: "报告识别修正说明：" + instruction,
      }]);
      setInput("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "重新识别失败，原有草稿已保留");
    } finally {
      setLoading(false);
    }
  };

  const confirmMedical = async () => {
    if (!medicalDraft || loading) return;
    setLoading(true);
    setError("");
    try {
      const saved = await medicalReportApi.commitDraft(
        medicalDraft.result, medicalDraft.images, medicalDraft.idempotencyKey,
      );
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "assistant",
        content: `已在本机归档 ${saved.length} 份医疗检查报告。请到「健康」查看原图和结构化结果。`,
      }]);
      setMedicalDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "本机归档失败，可再次点击确认重试");
    } finally {
      setLoading(false);
    }
  };

  const decide = async (approval: CloudAgentApproval, decision: "approve" | "reject") => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      await cloudAgentApi.decideApproval(approval.id, decision);
      if (sessionId) setApprovals(await cloudAgentApi.listApprovals(sessionId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "审批操作失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="lt-cloud-agent" aria-label="LifeTrace 云端 Agent">
      <aside className="lt-cloud-agent-history">
        <header>
          <div><Cloud/><span><strong>云端 Agent</strong><small>Cloud only</small></span></div>
          <button type="button" title="新会话" onClick={newSession}><MessageSquarePlus/></button>
        </header>
        <div className="lt-cloud-agent-history-list">
          {historyLoading ? <div className="lt-cloud-agent-muted"><LoaderCircle className="spin"/>加载会话…</div> : null}
          {!historyLoading && sessions.length === 0 ? <div className="lt-cloud-agent-muted">还没有云端会话</div> : null}
          {sessions.map((item) => (
            <article key={item.id} className={item.id === sessionId ? "active" : ""}>
              <button type="button" onClick={() => void openSession(item.id)}>
                <strong>{item.title || "未命名会话"}</strong>
                <small>{sessionStamp(item.lastMessageAt ?? item.updatedAt)}</small>
              </button>
              <button type="button" className="danger" title="删除会话" onClick={() => void removeSession(item.id)}><Trash2/></button>
            </article>
          ))}
        </div>
      </aside>

      <div className="lt-cloud-agent-main">
        <header className="lt-cloud-agent-hero">
          <div>
            <span className="lt-cloud-agent-orb"><Bot/></span>
            <span><strong>{activeSession?.title || "LifeTrace Agent"}</strong><small>由云端 Agent 服务处理；桌面端不运行本地模型或 Agent。</small></span>
          </div>
          <span className="lt-cloud-agent-trust"><ShieldCheck/>云端受控执行</span>
        </header>

        <div className="lt-cloud-agent-messages" aria-live="polite">
          {messages.length === 0 ? (
            <div className="lt-cloud-agent-empty">
              <Bot/>
              <h2>直接告诉我你要处理什么</h2>
              <p>Agent 会通过 LifeTrace 云端能力读取或操作授权数据；需要确认的动作会出现在审批区。</p>
            </div>
          ) : messages.map((message) => (
            <article key={message.id} className={`lt-cloud-agent-message ${message.role}`}>
              <span>{message.role === "assistant" ? <Bot/> : "我"}</span>
              <div>
                {message.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                ) : <p>{message.content}</p>}
                {message.provider ? <small>{message.provider}</small> : null}
              </div>
            </article>
          ))}
          {loading ? <div className="lt-cloud-agent-pending"><LoaderCircle className="spin"/>正在处理…</div> : null}
          <div ref={bottomRef}/>
        </div>

        {medicalDraft ? <MedicalImportReview
          draft={medicalDraft.result}
          disabled={loading}
          onConfirm={() => void confirmMedical()}
          onDiscard={() => setMedicalDraft(null)}
          onReextract={() => void reextractMedical(input)}
          correction={input}
        /> : null}

        {approvals.some((item) => item.status === "pending") ? (
          <section className="lt-cloud-agent-approvals">
            <header><ShieldCheck/><strong>等待你的确认</strong></header>
            {approvals.filter((item) => item.status === "pending").map((approval) => (
              <article key={approval.id}>
                <div><strong>{approval.actionName}</strong><small>{JSON.stringify(approval.actionJson)}</small></div>
                <div>
                  <button type="button" className="secondary" onClick={() => void decide(approval, "reject")}><X/>拒绝</button>
                  <button type="button" className="primary" onClick={() => void decide(approval, "approve")}><Check/>批准</button>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {error ? <div className="lt-cloud-agent-error" role="alert">{error}<button type="button" onClick={() => setError("")}><X/></button></div> : null}

        <form className="lt-cloud-agent-composer"
          onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDrop={(event) => {
            event.preventDefault();
            if (loading || medicalDraft) return;
            const files = Array.from(event.dataTransfer.files);
            try { validateFiles(files); setReportFiles(files); setError(""); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "无法添加医疗附件"); }
          }}
          onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            maxLength={4000}
            placeholder={medicalDraft ? "输入识别更正说明，例如：第二张是第一页的续页" : "给云端 Agent 一个任务…"}
            disabled={loading}
          />
          <label title="选择医疗报告图片" style={{ cursor: loading || medicalDraft ? "not-allowed" : "pointer" }}>
            <Paperclip/>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple
              aria-label="选择医疗报告图片" style={{ display: "none" }} disabled={loading || !!medicalDraft}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                try { validateFiles(files); setReportFiles(files); setError(""); }
                catch (cause) { setError(cause instanceof Error ? cause.message : "无法添加医疗附件"); }
              }}
            />
          </label>
          {reportFiles.length ? <span title={reportFiles.map((f) => f.name).join("、")} style={{ fontSize: 12 }}>
            {reportFiles.length} 张报告
            <button type="button" title="清除待上传报告" disabled={loading} onClick={() => setReportFiles([])}>×</button>
          </span> : null}
          <button type="button" title="刷新会话" disabled={loading} onClick={() => void refreshSessions().catch((cause) => setError(cause instanceof Error ? cause.message : "刷新失败"))}><RefreshCw/></button>
          <button type="submit" className="primary" disabled={loading || (medicalDraft ? !input.trim() : (!input.trim() && !reportFiles.length))}><ArrowUp/></button>
        </form>
      </div>
    </section>
  );
}

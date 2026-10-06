import { desktopApiClient } from "@/src/services/apiClient";

export type CloudAgentSession = {
  id: string;
  title: string;
  status: "active" | "archived" | string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
};

export type CloudAgentMessage = {
  id: string;
  sessionId: string;
  runId?: string | null;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  provider?: string | null;
  createdAt: string;
};

export type CloudAgentApproval = {
  id: string;
  sessionId: string;
  actionName: string;
  actionJson: Record<string, unknown>;
  status: string;
  requestedAt: string;
};

export type CloudAgentReply = {
  reply: string;
  provider: string;
  sessionId: string;
  runId: string;
  model?: string | null;
};

export const cloudAgentApi = {
  async ask(prompt: string, sessionId?: string | null): Promise<CloudAgentReply> {
    return desktopApiClient.request<CloudAgentReply>("/api/v1/web/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.trim(),
        ...(sessionId ? { sessionId } : {}),
        pageContext: {
          workspace: "desktop",
          view: "assistant",
          label: "LifeTrace Desktop",
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    });
  },

  async listSessions(limit = 30): Promise<CloudAgentSession[]> {
    const payload = await desktopApiClient.request<{ items?: CloudAgentSession[] }>(
      `/api/v1/assistant/sessions?limit=${encodeURIComponent(String(limit))}`,
    );
    return payload.items ?? [];
  },

  async listMessages(sessionId: string, limit = 100): Promise<CloudAgentMessage[]> {
    const payload = await desktopApiClient.request<{ items?: CloudAgentMessage[] }>(
      `/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}/messages?limit=${encodeURIComponent(String(limit))}`,
    );
    return payload.items ?? [];
  },

  async deleteSession(sessionId: string): Promise<void> {
    await desktopApiClient.request<Record<string, unknown>>(
      `/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
  },

  async listApprovals(sessionId: string, limit = 20): Promise<CloudAgentApproval[]> {
    const payload = await desktopApiClient.request<{ items?: CloudAgentApproval[] }>(
      `/api/v1/assistant/sessions/${encodeURIComponent(sessionId)}/approvals?limit=${encodeURIComponent(String(limit))}`,
    );
    return payload.items ?? [];
  },

  async decideApproval(approvalId: string, decision: "approve" | "reject"): Promise<void> {
    await desktopApiClient.request<Record<string, unknown>>(
      `/api/v1/assistant/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
  },
};

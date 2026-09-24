import { cloudAuthClient } from "@/src/services/cloudAuth";

export type MailProvider = "qq" | "163" | "126" | "yeah" | "generic";
export type MailSecurity = "tls" | "starttls";

export type MailAccount = {
  id: string;
  userId: string;
  provider: MailProvider | string;
  emailAddress: string;
  displayName?: string | null;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity | string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity | string;
  username: string;
  status: "validating" | "active" | "degraded" | "disabled" | string;
  idleSupported: boolean;
  lastValidatedAt?: string | null;
  lastSyncAt?: string | null;
  lastErrorCode?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MailAccountInput = {
  provider: MailProvider;
  emailAddress: string;
  displayName?: string;
  username?: string;
  authorizationCode: string;
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: MailSecurity;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: MailSecurity;
};

export type MailFolder = {
  id: string;
  accountId: string;
  remoteName: string;
  normalizedRole: "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "other" | string;
  uidvalidity?: number | null;
  uidnext?: number | null;
  lastSeenUid: number;
  lastSyncAt?: string | null;
  syncEnabled: boolean;
};

export type MailThread = {
  id: string;
  accountId: string;
  normalizedSubject: string;
  latestMessageAt?: string | null;
  messageCount: number;
  unreadCount: number;
  participantSummary?: string | null;
  snippet?: string | null;
};

export type MailMessage = {
  id: string;
  accountId: string;
  folderId: string;
  threadId: string;
  remoteUid: number;
  uidvalidity: number;
  messageId?: string | null;
  inReplyTo?: string | null;
  subject: string;
  fromJson: unknown;
  toJson: unknown;
  ccJson: unknown;
  replyToJson: unknown;
  sentAt?: string | null;
  receivedAt: string;
  flagsJson: unknown;
  isRead: boolean;
  isArchived: boolean;
  isStarred?: boolean;
  sizeBytes?: number | null;
  snippet?: string | null;
  bodyText?: string | null;
  bodyHtmlSanitized?: string | null;
  hasAttachments: boolean;
};

export type MailMessageSummary = {
  id: string;
  accountId: string;
  folderId: string;
  threadId: string;
  subject: string;
  fromJson: unknown;
  toJson: unknown;
  sentAt?: string | null;
  receivedAt: string;
  isRead: boolean;
  isArchived: boolean;
  isStarred?: boolean;
  snippet?: string | null;
  hasAttachments: boolean;
};

export type MailMessagePage = {
  items: MailMessageSummary[];
  hasMore: boolean;
  nextOffset: number;
};

export type MailAttachment = {
  id: string;
  messageId: string;
  partId: string;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes: number;
  contentId?: string | null;
  disposition?: string | null;
  checksum?: string | null;
  storageRef?: string | null;
  downloadState: string;
};

export type MailIdentity = {
  id: string;
  accountId: string;
  emailAddress: string;
  displayName?: string | null;
  replyTo?: string | null;
  signatureHtml?: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MailIdentityInput = {
  accountId: string;
  emailAddress: string;
  displayName?: string | null;
  replyTo?: string | null;
  signatureHtml?: string | null;
  isDefault?: boolean;
};

export type MailDraft = {
  id: string;
  accountId: string;
  identityId?: string | null;
  threadId?: string | null;
  inReplyToMessageId?: string | null;
  toJson: unknown;
  ccJson: unknown;
  bccJson: unknown;
  subject: string;
  bodyText: string;
  state: string;
  createdAt: string;
  updatedAt: string;
};

export type MailDraftInput = {
  accountId: string;
  identityId?: string | null;
  inReplyToMessageId?: string | null;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  bodyText?: string;
};

export type MailDraftAttachment = {
  id: string;
  draftId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type ConnectionTestResult = {
  imapOk: boolean;
  smtpOk: boolean;
  idleSupported: boolean;
  folders: string[];
};

export type SendMailInput = {
  identityId?: string | null;
  attachmentDraftId?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  inReplyToMessageId?: string | null;
  idempotencyKey: string;
};

export type MailMessageListOptions = {
  accountId?: string;
  folderId?: string;
  role?: string;
  q?: string;
  unreadOnly?: boolean;
  starredOnly?: boolean;
  limit?: number;
  offset?: number;
};

type ErrorPayload = { message?: string; code?: string; error?: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await cloudAuthClient.request(path, init);
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (!response.ok) {
    const error = payload as ErrorPayload | string | null;
    const message = typeof error === "string" ? error : error?.message || error?.error || error?.code;
    throw new Error(message || `邮件服务请求失败（${response.status}）`);
  }
  return payload as T;
}

async function binaryRequest(path: string): Promise<Blob> {
  const response = await cloudAuthClient.request(path);
  if (!response.ok) {
    let message = `附件下载失败（${response.status}）`;
    try {
      const payload = (await response.json()) as ErrorPayload;
      message = payload.message || payload.error || payload.code || message;
    } catch {
      // Keep the status-only message; never expose raw binary/server diagnostics.
    }
    throw new Error(message);
  }
  return response.blob();
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function query(path: string, values: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export const mailApi = {
  accounts: {
    list: async () => (await request<{ items: MailAccount[] }>("/api/v1/mail/accounts")).items,
    get: (id: string) => request<MailAccount>(`/api/v1/mail/accounts/${encodeURIComponent(id)}`),
    create: (input: MailAccountInput) => request<MailAccount>("/api/v1/mail/accounts", json("POST", input)),
    test: (id: string) => request<ConnectionTestResult>(`/api/v1/mail/accounts/${encodeURIComponent(id)}/test`, json("POST", {})),
    sync: (id: string) => request<{ ok: true; persisted: number; syncedMessages?: number }>(`/api/v1/mail/accounts/${encodeURIComponent(id)}/sync`, json("POST", {})),
    disconnect: (id: string) => request<{ ok: true }>(`/api/v1/mail/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
    folders: async (id: string) => (await request<{ items: MailFolder[] }>(`/api/v1/mail/accounts/${encodeURIComponent(id)}/folders`)).items,
    send: (id: string, input: SendMailInput) => request<{ ok: true; messageId: string }>(`/api/v1/mail/accounts/${encodeURIComponent(id)}/send`, json("POST", input)),
  },
  identities: {
    list: async () => (await request<{ items: MailIdentity[] }>("/api/v1/mail/identities")).items,
    create: (input: MailIdentityInput) => request<MailIdentity>("/api/v1/mail/identities", json("POST", input)),
    update: (id: string, input: MailIdentityInput) => request<MailIdentity>(`/api/v1/mail/identities/${encodeURIComponent(id)}`, json("PATCH", input)),
    remove: (id: string) => request<{ ok: true }>(`/api/v1/mail/identities/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  drafts: {
    list: async () => (await request<{ items: MailDraft[] }>("/api/v1/mail/drafts")).items,
    create: (input: MailDraftInput) => request<MailDraft>("/api/v1/mail/drafts", json("POST", input)),
    update: (id: string, input: MailDraftInput) => request<MailDraft>(`/api/v1/mail/drafts/${encodeURIComponent(id)}`, json("PATCH", input)),
    remove: (id: string) => request<{ ok: true }>(`/api/v1/mail/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }),
    send: (id: string) => request<{ ok: true; messageId: string }>(`/api/v1/mail/drafts/${encodeURIComponent(id)}/send`, json("POST", {})),
    attachments: async (id: string) => (await request<{ items: MailDraftAttachment[] }>(`/api/v1/mail/drafts/${encodeURIComponent(id)}/attachments`)).items,
    addAttachment: (id: string, file: File) => {
      const body = new FormData();
      body.append("file", file, file.name);
      return request<MailDraftAttachment>(`/api/v1/mail/drafts/${encodeURIComponent(id)}/attachments`, { method: "POST", body });
    },
    removeAttachment: (id: string, attachmentId: string) =>
      request<{ ok: true }>(`/api/v1/mail/drafts/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" }),
  },
  threads: {
    list: async (options: MailMessageListOptions = {}) =>
      (await request<{ items: MailThread[] }>(query("/api/v1/mail/threads", options))).items,
    messages: async (threadId: string) => (await request<{ items: MailMessage[] }>(`/api/v1/mail/threads/${encodeURIComponent(threadId)}/messages`)).items,
  },
  messages: {
    list: (options: MailMessageListOptions = {}) =>
      request<MailMessagePage>(query("/api/v1/mail/messages", options)),
    get: (id: string) => request<MailMessage>(`/api/v1/mail/messages/${encodeURIComponent(id)}`),
    attachments: async (id: string) => (await request<{ items: MailAttachment[] }>(`/api/v1/mail/messages/${encodeURIComponent(id)}/attachments`)).items,
    downloadAttachment: (id: string) => binaryRequest(`/api/v1/mail/attachments/${encodeURIComponent(id)}/content`),
    setRead: (id: string, read: boolean) => request<{ ok: true; read: boolean }>(`/api/v1/mail/messages/${encodeURIComponent(id)}/read`, json("POST", { read })),
    setStarred: (id: string, starred: boolean) => request<{ ok: true; starred: boolean }>(`/api/v1/mail/messages/${encodeURIComponent(id)}/star`, json("POST", { starred })),
    archive: (id: string) => request<{ ok: true }>(`/api/v1/mail/messages/${encodeURIComponent(id)}/archive`, json("POST", {})),
    move: (id: string, destinationRole: string) => request<{ ok: true; destinationRole: string }>(`/api/v1/mail/messages/${encodeURIComponent(id)}/move`, json("POST", { destinationRole })),
  },
};

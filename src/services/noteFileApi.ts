import { invoke } from "@tauri-apps/api/core";

export interface CloudNoteAttachment {
  id: string;
  domain: "notes_attachments";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
  availableAt?: string | null;
}

export interface DownloadedNoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  createdAt: string;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function requireDesktop(): void {
  if (!isTauriRuntime()) throw new Error("云附件传输仅在 LifeTrace Desktop 可用");
}

export const noteFileApi = {
  available: isTauriRuntime,
  async list(noteId: string): Promise<CloudNoteAttachment[]> {
    requireDesktop();
    return invoke<CloudNoteAttachment[]>("note_cloud_list_attachments", { noteId });
  },
  async upload(noteId: string, localPath: string): Promise<CloudNoteAttachment> {
    requireDesktop();
    return invoke<CloudNoteAttachment>("note_cloud_upload_attachment", { noteId, localPath });
  },
  async download(noteId: string, fileId: string): Promise<DownloadedNoteAttachment> {
    requireDesktop();
    return invoke<DownloadedNoteAttachment>("note_cloud_download_attachment", { noteId, fileId });
  },
  async remove(fileId: string): Promise<void> {
    requireDesktop();
    await invoke("note_cloud_delete_attachment", { fileId });
  },
};

import { desktopBridgeError } from "@/src/desktop/bridgeError";

function api() {
  if (typeof window === "undefined" || !window.noteApi) throw desktopBridgeError("笔记文件服务");
  return window.noteApi;
}

export const desktopNotes = {
  available: () => typeof window !== "undefined" && Boolean(window.noteApi),
  selectAttachment: (noteId: string) => api().selectAttachment(noteId),
  openAttachment: (noteId: string, fileName: string) => api().openAttachment(noteId, fileName),
  showAttachment: (noteId: string, fileName: string) => api().showAttachment(noteId, fileName),
  deleteAttachment: (noteId: string, fileName: string) => api().deleteAttachment(noteId, fileName),
  exportNote: (payload: { format: "md" | "html" | "json"; title: string; content: string }) =>
    api().exportNote(payload),
  importMarkdown: () => api().importMarkdown(),
  onCommand: (listener: (command: string) => void) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.onCommand(listener)
      : () => undefined,
};

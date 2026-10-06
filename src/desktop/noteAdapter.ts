import { desktopBridgeError } from "@/src/desktop/bridgeError";

function api() {
  if (typeof window === "undefined" || !window.noteApi) throw desktopBridgeError("笔记文件服务");
  return window.noteApi;
}

function unavailable() {
  return { ok: false as const, error: desktopBridgeError("笔记文件服务").message };
}

export const desktopNotes = {
  available: () => typeof window !== "undefined" && Boolean(window.noteApi),
  selectAttachment: (noteId: string) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.selectAttachment(noteId)
      : Promise.resolve({ ...unavailable(), canceled: false }),
  openAttachment: (noteId: string, fileName: string) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.openAttachment(noteId, fileName)
      : Promise.resolve(unavailable()),
  showAttachment: (noteId: string, fileName: string) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.showAttachment(noteId, fileName)
      : Promise.resolve(unavailable()),
  deleteAttachment: (noteId: string, fileName: string) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.deleteAttachment(noteId, fileName)
      : Promise.resolve(unavailable()),
  exportNote: (payload: { format: "md" | "html" | "json"; title: string; content: string }) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.exportNote(payload)
      : Promise.resolve({ ...unavailable(), canceled: false }),
  importMarkdown: () =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.importMarkdown()
      : Promise.resolve({ ...unavailable(), canceled: false }),
  onCommand: (listener: (command: string) => void) =>
    typeof window !== "undefined" && window.noteApi
      ? window.noteApi.onCommand(listener)
      : () => undefined,
  require: api,
};

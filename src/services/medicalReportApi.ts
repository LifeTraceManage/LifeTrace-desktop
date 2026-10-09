import { invoke } from "@tauri-apps/api/core";

export type MedicalImageInput = {
  assetId: string;
  originalName: string;
  mimeType: string;
  base64: string;
};
export type MedicalEvidence = {
  sourceAssetId: string;
  pageIndex: number;
};
export type MedicalSection = MedicalEvidence & {
  kind: string;
  titleRaw: string;
  textRaw: string;
};
export type MedicalObservation = MedicalEvidence & {
  nameRaw: string;
  kind: string;
  valueRaw: string;
  valueNumber?: number | null;
  metricKey?: string | null;
  comparator?: string | null;
  unitRaw?: string | null;
  referenceRangeRaw?: string | null;
  sourceFlag?: string | null;
  bodySite?: string | null;
  laterality?: string | null;
};
export type MedicalReportDraft = {
  title: string;
  reportType: string;
  examAt?: string | null;
  collectionAt?: string | null;
  issuedAt?: string | null;
  facility?: string | null;
  department?: string | null;
  reportNo?: string | null;
  bodySite?: string | null;
  sourceAssetIds: string[];
  sections: MedicalSection[];
  observations: MedicalObservation[];
  needsReview?: boolean;
  reviewReasons?: string[];
};
export type MedicalExtractReply = {
  schemaVersion: number;
  reports: MedicalReportDraft[];
  groupingWarnings: string[];
  requiresConfirmation: boolean;
};
export type MedicalListItem = {
  id: string;
  title: string;
  reportType: string;
  examAt: string | null;
  facility: string | null;
  createdAt: string;
  observationCount: number;
  attachmentCount: number;
};
export type SavedMedicalReport = { id: string; title: string };
export type MedicalBackupResult = { path: string; reports: number; files: number };
export type MedicalArchiveIntegrity = {
  checkedFiles: number;
  missingFiles: number;
  corruptFiles: number;
  orphanFiles: number;
  checkedReports: number;
};
export type MedicalReportRevision = {
  id: string;
  changedAt: string;
  previous: MedicalReportDraft;
  updated: MedicalReportDraft;
};
export type MedicalDuplicateMatch = {
  sourceAssetId: string;
  existingReportId: string | null;
  existingTitle: string | null;
};
export type MedicalMetricHistoryPoint = {
  reportId: string;
  reportTitle: string;
  examAt: string;
  valueNumber: number;
  unitRaw: string;
};
export type MedicalAssetInfo = {
  id: string;
  originalName: string;
  mimeType: string;
  bytesSize: number;
};
export type MedicalReportDetail = {
  id: string;
  report: MedicalReportDraft;
  assets: MedicalAssetInfo[];
};
export type MedicalAssetData = {
  originalName: string;
  mimeType: string;
  base64: string;
};
export const medicalReportApi = {
  exportBackup(directory: string) {
    return invoke<MedicalBackupResult>("medical_export_backup", { directory });
  },
  importBackup(directory: string) {
    return invoke<MedicalBackupResult>("medical_import_backup", { directory });
  },
  replaceReport(reportId: string, draft: MedicalExtractReply, idempotencyKey: string) {
    return invoke<SavedMedicalReport>("medical_replace_report", {
      input: { reportId, draft, idempotencyKey },
    });
  },
  checkDuplicates(images: MedicalImageInput[]) {
    return invoke<MedicalDuplicateMatch[]>("medical_check_duplicates", { images });
  },
  commitDraft(draft: MedicalExtractReply, assets: MedicalImageInput[], idempotencyKey: string) {
    return invoke<SavedMedicalReport[]>("medical_commit_draft", {
      input: { idempotencyKey, draft, assets },
    });
  },
  list() {
    return invoke<MedicalListItem[]>("medical_list_reports");
  },
  metricHistory(nameRaw: string, unitRaw: string) {
    return invoke<MedicalMetricHistoryPoint[]>("medical_metric_history", { nameRaw, unitRaw });
  },
  detail(id: string) {
    return invoke<MedicalReportDetail>("medical_get_report", { id });
  },
  listRevisions(reportId: string) {
    return invoke<MedicalReportRevision[]>("medical_list_revisions", { reportId });
  },
  readAsset(id: string) {
    return invoke<MedicalAssetData>("medical_read_asset", { id });
  },
};

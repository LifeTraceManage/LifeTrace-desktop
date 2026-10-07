import { localJsonRequest } from "@/src/services/localJsonTransport";

export type PhotoSyncPhoto = {
  id: string;
  original_file_name: string;
  media_type: "image" | "video";
  mime_type: string | null;
  file_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  captured_at: string | null;
  imported_at: string;
  processing_status: string;
  processing_error: string | null;
  device_name: string | null;
};

export type PhotoSyncDevice = {
  id: string;
  device_name: string;
  device_type: string;
  status: "active" | "revoked";
  paired_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export type PhotoSyncUploadTask = {
  id: string;
  original_file_name: string;
  expected_file_size: number;
  received_file_size: number;
  status: string;
  photo_id: string | null;
  updated_at: string;
  error_code: string | null;
  error_message: string | null;
};

export type PhotoSyncDashboard = {
  photos: PhotoSyncPhoto[];
  total: number;
  page: number;
  pageSize: number;
  devices: PhotoSyncDevice[];
  tasks: PhotoSyncUploadTask[];
  summary: {
    success_count?: number;
    duplicate_count?: number;
    failed_count?: number;
    processing_count?: number;
    last_sync_at?: string;
  };
};

const MEDIA_BASE = "http://127.0.0.1:3444/photo-sync/media";

export function photoMediaUrl(photoId: string, kind: "thumbnail" | "original"): string {
  return `${MEDIA_BASE}/${encodeURIComponent(photoId)}/${kind}`;
}

export async function loadPhotoSyncDashboard(
  page: number,
  pageSize = 30,
): Promise<PhotoSyncDashboard> {
  const path = `/api/photo-sync/dashboard?page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(pageSize))}`;
  return localJsonRequest<PhotoSyncDashboard>(path, undefined, "照片数据读取失败");
}

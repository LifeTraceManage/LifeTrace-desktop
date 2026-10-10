import type { MedicalImageInput } from "@/src/services/medicalReportApi";

/**
 * The medical import pipeline accepts source images only. No PDF rendering,
 * no OCR, and no image recompression; store the exact uploaded image bytes.
 */
export const MAX_MEDICAL_IMAGES = 8;
export const MAX_MEDICAL_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MEDICAL_BATCH_BYTES = 12 * 1024 * 1024;
export const MEDICAL_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function checkMedicalImageLimits(files: File[]): void {
  if (!files.length || files.length > MAX_MEDICAL_IMAGES) {
    throw new Error("每次请选择 1 至 8 张检查报告图片");
  }
  if (files.some((file) => !MEDICAL_IMAGE_TYPES.has(file.type))) {
    throw new Error("医疗检查报告仅支持 JPG、PNG 和 WebP 图片");
  }
  if (files.some((file) => file.size === 0 || file.size > MAX_MEDICAL_IMAGE_BYTES) ||
      files.reduce((total, file) => total + file.size, 0) > MAX_MEDICAL_BATCH_BYTES) {
    throw new Error("单张图片最多 5 MiB，每批最多 12 MiB");
  }
}

function readOriginalBytes(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string" || !value.startsWith("data:") || !value.includes(",")) {
        reject(new Error("读取检查报告原图失败"));
        return;
      }
      resolve(value.slice(value.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("读取检查报告原图失败"));
    reader.readAsDataURL(file);
  });
}

/** For the vision call and local commit, use identical IDs and unmodified bytes. */
export async function prepareMedicalImages(files: File[]): Promise<MedicalImageInput[]> {
  checkMedicalImageLimits(files);
  return Promise.all(files.map(async (file) => ({
    assetId: crypto.randomUUID(),
    originalName: file.name,
    mimeType: file.type,
    base64: await readOriginalBytes(file),
  })));
}

/** Re-identification of archived reports uses their persistent image IDs. */
export function checkArchivedMedicalImages(images: MedicalImageInput[]): void {
  if (!images.length || images.length > MAX_MEDICAL_IMAGES) {
    throw new Error("原报告图片数量超出限制");
  }
  let total = 0;
  const ids = new Set<string>();
  for (const image of images) {
    if (!MEDICAL_IMAGE_TYPES.has(image.mimeType)) {
      throw new Error("医疗检查仅支持原始 JPG、PNG 和 WebP 图片");
    }
    if (!image.assetId || ids.has(image.assetId)) {
      throw new Error("原报告图片 ID 重复");
    }
    ids.add(image.assetId);
    const estimated = Math.floor(image.base64.length * 3 / 4);
    if (estimated === 0 || estimated > MAX_MEDICAL_IMAGE_BYTES + 2) {
      throw new Error("原报告图片超过大小限制");
    }
    total += estimated;
  }
  if (total > MAX_MEDICAL_BATCH_BYTES + images.length * 2) {
    throw new Error("原报告图片总大小超过 12 MiB");
  }
}

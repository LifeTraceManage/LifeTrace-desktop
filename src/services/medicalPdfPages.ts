import type {
  MedicalExtractReply,
  MedicalImageInput,
  MedicalReportDraft,
} from "@/src/services/medicalReportApi";

/**
 * PDF.js is used only to render full PDF pages as JPEG inputs to the vision model.
 * NO PDF text extraction or OCR is performed. The original PDF bytes are archived.
 */
export const MAX_MEDICAL_SOURCE_FILES = 8;
export const MAX_MEDICAL_VISION_PAGES = 8;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
const MAX_VISION_BYTES = 12 * 1024 * 1024;
const SUPPORTED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export type MedicalPageSource = { originalAssetId: string; pageIndex: number };
export type PreparedMedicalUploads = {
  originals: MedicalImageInput[];
  vision: MedicalImageInput[];
  sourcePages: Record<string, MedicalPageSource>;
};

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value === "string" && value.includes(",")) {
        resolve(value.slice(value.indexOf(",") + 1));
      } else reject(new Error("无法读取原始检查报告"));
    };
    reader.onerror = () => reject(new Error("无法读取原始检查报告"));
    reader.readAsDataURL(file);
  });
}

function inputBytes(base64: string): number {
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

export function checkMedicalFileLimits(files: File[]): void {
  if (!files.length || files.length > MAX_MEDICAL_SOURCE_FILES) {
    throw new Error("一次最多上传 8 个医疗报告文件");
  }
  if (files.some((f) => !SUPPORTED.has(f.type))) {
    throw new Error("仅支持 JPG、PNG、WebP、PDF 报告");
  }
  if (files.some((f) => f.size === 0 ||
      f.size > (f.type === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) ||
      files.reduce((n, f) => n + f.size, 0) > MAX_ORIGINAL_BYTES) {
    throw new Error("单张图片最多 5 MiB、单份 PDF 最多 20 MiB，原文件合计不超过 30 MiB");
  }
}

async function renderPdfPages(file: File): Promise<string[]> {
  // Lazy loading means ordinary Agent text messages do not load PDF.js.
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length < 5 || String.fromCharCode(...data.subarray(0, 5)) !== "%PDF-") {
    throw new Error("文件内容不是有效的 PDF");
  }
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  try {
    if (!doc.numPages || doc.numPages > MAX_MEDICAL_VISION_PAGES) {
      throw new Error("单份 PDF 最多支持 8 页；请拆分后分别导入");
    }
    const images: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 2400 / Math.max(unscaled.width, unscaled.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前桌面环境无法渲染 PDF");
      try {
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const base64 = canvas.toDataURL("image/jpeg", 0.86).split(",")[1];
        if (!base64 || inputBytes(base64) > MAX_IMAGE_BYTES) {
          throw new Error("PDF 页面图片超过 5 MiB，请降低 PDF 分辨率后重试");
        }
        images.push(base64);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    return images;
  } finally {
    await doc.destroy();
  }
}

/** Convert source PDFs to model images while retaining exact original file bytes. */
export async function prepareMedicalUploads(
  files: File[],
  existingSourceIds?: string[],
): Promise<PreparedMedicalUploads> {
  checkMedicalFileLimits(files);
  if (existingSourceIds && existingSourceIds.length !== files.length) {
    throw new Error("原始文件 ID 数量与文件不符");
  }
  const result: PreparedMedicalUploads = { originals: [], vision: [], sourcePages: {} };
  let visionBytes = 0;
  for (const [index, file] of files.entries()) {
    const originalId = existingSourceIds?.[index] ?? crypto.randomUUID();
    if (!originalId) throw new Error("原始文件标识缺失");
    const original = {
      assetId: originalId, originalName: file.name,
      mimeType: file.type, base64: await fileBase64(file),
    };
    result.originals.push(original);

    if (file.type === "application/pdf") {
      const pages = await renderPdfPages(file);
      for (const [pageIndex, base64] of pages.entries()) {
        const pageId = crypto.randomUUID();
        result.vision.push({ assetId: pageId, originalName: file.name + " · 第" + (pageIndex + 1) + "页",
          mimeType: "image/jpeg", base64 });
        result.sourcePages[pageId] = { originalAssetId: originalId, pageIndex };
        visionBytes += inputBytes(base64);
      }
    } else {
      result.vision.push(original);
      result.sourcePages[originalId] = { originalAssetId: originalId, pageIndex: 0 };
      visionBytes += file.size;
    }
    if (result.vision.length > MAX_MEDICAL_VISION_PAGES || visionBytes > MAX_VISION_BYTES) {
      throw new Error("本次报告合计最多 8 张/页、识别图像合计不能超过 12 MiB；请分批上传");
    }
  }
  return result;
}

/**
 * Page IDs are temporary and only for inference. Replace them with durable original
 * PDF/image IDs, and set the original PDF page index on every evidence field.
 */
export function mapVisionDraftToOriginals(
  result: MedicalExtractReply,
  pageSources: Record<string, MedicalPageSource>,
): MedicalExtractReply {
  const mapOne = (id: string): MedicalPageSource => {
    const source = pageSources[id];
    if (!source) throw new Error("识别结果引用了未知的原始报告页面");
    return source;
  };
  const reports: MedicalReportDraft[] = result.reports.map((report) => {
    const sourceAssetIds = Array.from(new Set(report.sourceAssetIds.map((id) => mapOne(id).originalAssetId)));
    return {
      ...report,
      sourceAssetIds,
      sections: report.sections.map((section) => {
        const origin = mapOne(section.sourceAssetId);
        return { ...section, sourceAssetId: origin.originalAssetId, pageIndex: origin.pageIndex };
      }),
      observations: report.observations.map((observation) => {
        const origin = mapOne(observation.sourceAssetId);
        return { ...observation, sourceAssetId: origin.originalAssetId, pageIndex: origin.pageIndex };
      }),
    };
  });
  return { ...result, reports };
}

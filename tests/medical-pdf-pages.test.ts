import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkMedicalFileLimits,
  mapVisionDraftToOriginals,
} from "../src/services/medicalPdfPages";

test("maps all PDF page citations to one durable source PDF with correct page indices", () => {
  const draft = {
    schemaVersion: 1,
    groupingWarnings: [],
    requiresConfirmation: true,
    reports: [{
      title: "血常规", reportType: "laboratory",
      sourceAssetIds: ["page-0", "page-1"],
      sections: [
        { kind: "findings", titleRaw: "所见", textRaw: "原文",
          sourceAssetId: "page-1", pageIndex: 0 },
      ],
      observations: [
        { nameRaw: "血红蛋白", kind: "numeric", valueRaw: "145",
          sourceAssetId: "page-0", pageIndex: 0 },
        { nameRaw: "白细胞", kind: "numeric", valueRaw: "6.25",
          sourceAssetId: "page-1", pageIndex: 0 },
      ],
    }],
  };
  const original = structuredClone(draft);
  const mapped = mapVisionDraftToOriginals(draft, {
    "page-0": { originalAssetId: "original-pdf", pageIndex: 0 },
    "page-1": { originalAssetId: "original-pdf", pageIndex: 1 },
  });
  assert.deepEqual(mapped.reports[0].sourceAssetIds, ["original-pdf"]);
  assert.equal(mapped.reports[0].sections[0].sourceAssetId, "original-pdf");
  assert.equal(mapped.reports[0].sections[0].pageIndex, 1);
  assert.equal(mapped.reports[0].observations[1].sourceAssetId, "original-pdf");
  assert.equal(mapped.reports[0].observations[1].pageIndex, 1);
  assert.deepEqual(draft, original, "source model response must not be mutated");
});

test("remaps mixed source photos and PDF pages across different reports", () => {
  const result = mapVisionDraftToOriginals({
    schemaVersion: 1, groupingWarnings: [], requiresConfirmation: true,
    reports: [
      { title: "血液报告", reportType: "laboratory", sourceAssetIds: ["pdf-1"],
        sections: [], observations: [] },
      { title: "超声", reportType: "ultrasound", sourceAssetIds: ["img-1"],
        sections: [], observations: [] },
    ],
  }, {
    "pdf-1": { originalAssetId: "actual.pdf", pageIndex: 2 },
    "img-1": { originalAssetId: "actual.jpg", pageIndex: 0 },
  });
  assert.equal(result.reports[0].sourceAssetIds[0], "actual.pdf");
  assert.equal(result.reports[1].sourceAssetIds[0], "actual.jpg");
});

test("refuses hallucinated source page IDs rather than archiving untraceable results", () => {
  assert.throws(() => mapVisionDraftToOriginals({
    schemaVersion: 1, groupingWarnings: [], requiresConfirmation: true,
    reports: [{ title: "检查", reportType: "laboratory", sourceAssetIds: ["missing"],
      sections: [], observations: [] }],
  }, {}), /未知的原始报告页面/);
});

test("validates PDF size separately from source JPEG and checks aggregate limit", () => {
  const make = (size: number, type: string) => ({ size, type }) as File;
  assert.doesNotThrow(() => checkMedicalFileLimits([make(10 * 1024 * 1024, "application/pdf")]));
  assert.throws(() => checkMedicalFileLimits([make(10 * 1024 * 1024, "image/jpeg")]), /20 MiB/);
  assert.throws(() => checkMedicalFileLimits([make(21 * 1024 * 1024, "application/pdf")]), /20 MiB/);
  assert.throws(() => checkMedicalFileLimits([make(19 * 1024 * 1024, "application/pdf"),
    make(19 * 1024 * 1024, "application/pdf")]), /30 MiB/);
  assert.throws(() => checkMedicalFileLimits([make(100, "application/msword")]), /仅支持/);
});

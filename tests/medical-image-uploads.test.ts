import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkMedicalImageLimits,
  checkArchivedMedicalImages,
} from "../src/services/medicalImageUploads";

type ImageFile = File;
const fakeFile = (size: number, type: string): ImageFile => ({ size, type }) as File;

test("medical Agent accepts only eight ordinary image sources", () => {
  assert.doesNotThrow(() => checkMedicalImageLimits([fakeFile(1024, "image/jpeg")]));
  assert.doesNotThrow(() => checkMedicalImageLimits([
    fakeFile(1, "image/png"), fakeFile(1, "image/webp"),
  ]));
  assert.throws(() => checkMedicalImageLimits([]), /1 至 8/);
  assert.throws(() => checkMedicalImageLimits(
    Array.from({ length: 9 }, () => fakeFile(1, "image/jpeg"))), /1 至 8/);
  assert.throws(() => checkMedicalImageLimits([fakeFile(1000, "application/pdf")]), /仅支持/);
  assert.throws(() => checkMedicalImageLimits([fakeFile(1000, "image/gif")]), /仅支持/);
});

test("medical image sizes are validated before calling vision provider", () => {
  assert.throws(() => checkMedicalImageLimits([fakeFile(0, "image/jpeg")]), /5 MiB/);
  assert.throws(() => checkMedicalImageLimits([fakeFile(5 * 1024 * 1024 + 1, "image/jpeg")]), /5 MiB/);
  assert.throws(() => checkMedicalImageLimits(
    Array.from({ length: 3 }, () => fakeFile(5 * 1024 * 1024, "image/png"))), /12 MiB/);
  assert.doesNotThrow(() => checkMedicalImageLimits([
    fakeFile(4 * 1024 * 1024, "image/png"), fakeFile(4 * 1024 * 1024, "image/jpeg"),
  ]));
});

test("archived photos must have supported MIME, distinct IDs and bounded raw bytes", () => {
  const encode = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);
  const image = (id: string, bytes: number, mimeType = "image/jpeg") =>
    ({ assetId: id, mimeType, originalName: id + ".jpg", base64: encode(bytes) });
  assert.doesNotThrow(() => checkArchivedMedicalImages([image("photo1", 1024)]));
  assert.throws(() => checkArchivedMedicalImages([image("photo1", 1024),
    image("photo1", 1024)]), /重复/);
  assert.throws(() => checkArchivedMedicalImages([image("pdf", 256, "application/pdf")]), /仅支持/);
  assert.throws(() => checkArchivedMedicalImages([image("large", 6 * 1024 * 1024)]), /大小限制/);
  assert.throws(() => checkArchivedMedicalImages([
    image("a", 5 * 1024 * 1024), image("b", 5 * 1024 * 1024),
    image("c", 4 * 1024 * 1024),
  ]), /12 MiB/);
});

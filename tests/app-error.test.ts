import assert from "node:assert/strict";
import test from "node:test";

import {
  AppError,
  appErrorFromHttp,
  normalizeAppError,
} from "../src/services/appError";

test("AppError maps common backend statuses to stable desktop codes", () => {
  assert.equal(appErrorFromHttp(401, "login").code, "UNAUTHORIZED");
  assert.equal(appErrorFromHttp(403, "forbidden").code, "FORBIDDEN");
  assert.equal(appErrorFromHttp(404, "missing").code, "NOT_FOUND");
  assert.equal(appErrorFromHttp(409, "conflict").code, "CONFLICT");
  assert.equal(appErrorFromHttp(422, "invalid").code, "VALIDATION_ERROR");

  const server = appErrorFromHttp(503, "down");
  assert.equal(server.code, "SERVER_ERROR");
  assert.equal(server.retryable, true);
});

test("AppError preserves normalized application failures", () => {
  const original = new AppError({
    code: "OFFLINE",
    message: "offline",
    retryable: true,
  });
  assert.equal(normalizeAppError(original), original);

  const network = normalizeAppError(new Error("Failed to fetch"));
  assert.equal(network.code, "NETWORK_ERROR");
  assert.equal(network.retryable, true);
});

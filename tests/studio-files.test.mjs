import assert from "node:assert/strict";
import test from "node:test";
import { safeStudioDownloadName, validateStudioFile } from "../lib/studio-files.mjs";

test("Studio brief attachments require an allow-listed extension and matching signature", () => {
  assert.equal(validateStudioFile({ kind: "BRIEF_ATTACHMENT", fileName: "brief.pdf", claimedType: "application/pdf", buffer: Buffer.from("%PDF-1.7 safe brief") }).ok, true);
  assert.equal(validateStudioFile({ kind: "BRIEF_ATTACHMENT", fileName: "brief.pdf", claimedType: "application/pdf", buffer: Buffer.from("not a pdf") }).ok, false);
  assert.equal(validateStudioFile({ kind: "BRIEF_ATTACHMENT", fileName: "brief.docx", claimedType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK unsafe archive") }).ok, false);
});

test("Studio audio previews use signature validation and file-size limits", () => {
  assert.equal(validateStudioFile({ kind: "AUDIO_PREVIEW", fileName: "preview.mp3", claimedType: "audio/mpeg", buffer: Buffer.from("ID3safe-preview") }).ok, true);
  assert.equal(validateStudioFile({ kind: "FINAL_MASTER", fileName: "master.mp3", claimedType: "audio/mpeg", buffer: Buffer.from("renamed content") }).ok, false);
  assert.match(validateStudioFile({ kind: "BRIEF_ATTACHMENT", fileName: "large.txt", claimedType: "text/plain", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 65) }).error, /10 MB/);
});

test("Studio download names cannot inject headers or paths", () => {
  assert.equal(safeStudioDownloadName("../script\r\n.pdf"), ".._script__.pdf");
});


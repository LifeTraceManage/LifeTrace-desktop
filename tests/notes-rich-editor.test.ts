import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("src/components/NotesModule.tsx", "utf8");
const richSource = readFileSync("src/components/RichMarkdownEditor.tsx", "utf8");
const styles = readFileSync("app/notes.css", "utf8");

test("notes open with a focused editable canvas and optional chrome", () => {
  assert.match(moduleSource, /useState<"rich"\|"split"\|"source"\|"preview">\("rich"\)/);
  assert.match(moduleSource, /showFormatting&&effectiveEditorMode!=="rich"&&<div className="nt-formatbar"/);
  assert.match(moduleSource, /showInspector&&<aside className="nt-inspector"/);
  assert.match(moduleSource, /data-testid="markdown-editor"/);
  assert.match(moduleSource, /<RichMarkdownEditor/);
  assert.match(styles, /\.nt-edit-layout\.nt-mode-rich/);
});

test("inline Markdown editing preserves source fallback for unsupported syntax", () => {
  assert.match(moduleSource, /hasUnsupportedRichSyntax/);
  assert.match(moduleSource, /attachment:\\\/\\\//);
  assert.match(moduleSource, /editorMode==="rich"&&!hasUnsupportedRichSyntax/);
  assert.match(richSource, /onChangeRef\.current\(next\)/);
  assert.match(richSource, /lastEmitted\.current = next/);
  assert.match(richSource, /emitUpdate: false/);
  assert.match(richSource, /selectedText\(\)/);
  assert.match(richSource, /insertText\(text: string\)/);
});

test("rich editor renders safe Markdown and exposes expected formatting tools", () => {
  assert.match(richSource, /ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(richSource, /StarterKit\.configure/);
  assert.match(richSource, /TaskItem\.configure/);
  assert.match(richSource, /toggleTaskList/);
  assert.match(richSource, /toggleCodeBlock/);
  assert.match(richSource, /TurndownService/);
});

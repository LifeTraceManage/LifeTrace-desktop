import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("src/components/NotesModule.tsx", "utf8");
const richSource = readFileSync("src/components/RichMarkdownEditor.tsx", "utf8");
const styles = readFileSync("app/notes.css", "utf8");

test("notes have exactly one inline live editor and no view mode switcher", () => {
  assert.match(moduleSource, /<RichMarkdownEditor/);
  assert.match(moduleSource, /nt-edit-layout nt-mode-rich/);
  assert.doesNotMatch(moduleSource, /editorMode|setEditorMode|effectiveEditorMode/);
  assert.doesNotMatch(moduleSource, /nt-view-switch|nt-markdown-preview|data-testid="markdown-editor"/);
  assert.match(moduleSource, /showInspector&&!focusMode&&<aside className="nt-inspector"/);
  assert.match(moduleSource, /nt-focus-mode/);
  assert.match(moduleSource, /nt-library-collapsed/);
  assert.match(styles, /\.nt-edit-layout\.nt-mode-rich/);
});

test("live editor protects Markdown extensions without switching to source mode", () => {
  assert.match(richSource, /hasUnsupportedMarkdown/);
  assert.match(richSource, /attachment:\\\/\\\//);
  assert.match(richSource, /nt-rich-protected/);
  assert.match(richSource, /onChangeRef\.current\(next\)/);
  assert.match(richSource, /lastEmitted\.current = next/);
  assert.match(richSource, /emitUpdate: false/);
  assert.match(richSource, /focusHeading\(text: string\)/);
  assert.match(richSource, /insertText\(text: string\)/);
  assert.match(moduleSource, /richEditorRef\.current\?\.focusHeading/);
});

test("rich editor renders safe Markdown and exposes expected formatting tools", () => {
  assert.match(richSource, /ReactMarkdown remarkPlugins=\{\[remarkGfm\]\}/);
  assert.match(richSource, /StarterKit\.configure/);
  assert.match(richSource, /TaskItem\.configure/);
  assert.match(richSource, /toggleTaskList/);
  assert.match(richSource, /toggleCodeBlock/);
  assert.match(richSource, /TurndownService/);
});


test("desktop notes are full-bleed without the enclosing workspace card", () => {
  const shell = readFileSync("src/components/DesktopWorkbenchShell.tsx", "utf8");
  const routeStyle = readFileSync("app/desktop-cloud-workspace.css", "utf8");
  assert.match(shell, /routeIsActive\(route, "\/app\/notes"\) \? " notes-route"/);
  assert.match(routeStyle, /\.lt-desk-content\.notes-route\s*\{/);
  assert.match(routeStyle, /\.lt-desk-content\.notes-route > \.lt-desk-route-content/);
  assert.match(styles, /\.lt-desk-content\.notes-route \.nt-workspace/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const moduleSource = readFileSync("src/components/NotesModule.tsx", "utf8");
const richSource = readFileSync("src/components/RichMarkdownEditor.tsx", "utf8");
const styles = readFileSync("app/notes.css", "utf8");

test("only CodeMirror is used for live Markdown, without a separate source view", () => {
  assert.match(moduleSource, /<CodeMirrorMarkdownEditor/);
  assert.match(moduleSource, /nt-edit-layout nt-mode-rich/);
  assert.doesNotMatch(moduleSource, /RichMarkdownEditor|editorMode|setEditorMode|effectiveEditorMode/);
  assert.doesNotMatch(moduleSource, /nt-view-switch|nt-markdown-preview|data-testid="markdown-editor"/);
  assert.match(moduleSource, /showInspector&&!focusMode&&<aside className="nt-inspector"/);
  assert.match(moduleSource, /nt-focus-mode|nt-library-collapsed/);
  assert.match(styles, /\.nt-cm-editor/);
});

test("CodeMirror live preview keeps Markdown as the actual editable document", () => {
  const cm = readFileSync("src/components/CodeMirrorMarkdownEditor.tsx", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(cm, /from "@codemirror\/state"/);
  assert.match(cm, /from "@codemirror\/view"/);
  assert.match(cm, /markdown\(\), history\(\)/);
  assert.match(cm, /EditorState\.create/);
  assert.match(cm, /update\.state\.doc\.toString\(\)/);
  assert.match(cm, /Decoration\.replace/);
  assert.match(cm, /update\.selectionSet/);
  assert.match(cm, /focusHeading\(text: string\)/);
  assert.match(cm, /insertText\(text: string\)/);
  assert.match(cm, /attachment:\\\/\\\//);
  assert.doesNotMatch(cm, /TurndownService|setContent\(|getHTML\(|@tiptap/);
  assert.ok(packageJson.dependencies["@codemirror/lang-markdown"]);
  assert.ok(packageJson.dependencies["@codemirror/view"]);
  assert.equal(packageJson.dependencies["@tiptap/react"], undefined);
});

test("desktop notes are full-bleed without the enclosing workspace card", () => {
  const shell = readFileSync("src/components/DesktopWorkbenchShell.tsx", "utf8");
  const routeStyle = readFileSync("app/desktop-cloud-workspace.css", "utf8");
  assert.match(shell, /routeIsActive\(route, "\/app\/notes"\) \? " notes-route"/);
  assert.match(routeStyle, /\.lt-desk-content\.notes-route\s*\{/);
  assert.match(routeStyle, /\.lt-desk-content\.notes-route > \.lt-desk-route-content/);
  assert.match(styles, /\.lt-desk-content\.notes-route \.nt-workspace/);
});

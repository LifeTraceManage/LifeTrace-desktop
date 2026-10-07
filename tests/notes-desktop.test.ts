import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("desktop notes mirrors the web workspace without mounting vendor web", () => {
  const notes = read("src/components/NotesModule.tsx");
  const css = read("app/notes.css");
  const api = read("src/services/noteApi.ts");

  assert.match(notes, /data-testid="notes-workspace"/);
  assert.match(notes, /data-testid="notes-sidebar"/);
  assert.match(notes, /data-testid="notes-inspector"/);
  assert.match(notes, /Notes Graph/);
  assert.match(notes, /openDailyNote/);
  assert.match(notes, /nt-tabs/);
  assert.match(notes, /Inbox/);
  assert.match(notes, /Backlinks/);
  assert.match(notes, /版本历史/);
  assert.match(notes, /Status/);
  assert.match(notes, /Source/);
  assert.match(notes, /Aliases/);
  assert.match(notes, /executionApi\.tasks\.create/);
  assert.match(notes, /executionApi\.relations\.create/);
  assert.match(notes, /Markdown/);
  assert.match(notes, /data-testid="markdown-editor"/);
  assert.match(notes, /type:"markdown",source:markdown,editor:"desktop-markdown"/);
  assert.doesNotMatch(notes, /useEditor|EditorContent|StarterKit|DOMPurify|turndown/);
  assert.doesNotMatch(notes, /vendor\/web|NotesPage/);
  assert.doesNotMatch(notes, /sendBeacon|\/api\/notes/);
  assert.match(api, /invoke<T>\("notes_query"/);
  assert.match(api, /invoke<T>\("notes_mutate"/);
  assert.match(api, /graph:\(limit=80\)=>query<NoteGraph>/);
  assert.match(notes, /noteApi\.graph\(80\)/);

  assert.match(css, /\.nt-workspace\{/);
  assert.doesNotMatch(css, /\.nt-workspace\{[^}]*border-radius/s);
  assert.doesNotMatch(css, /\.nt-workspace\{[^}]*box-shadow/s);
  assert.match(css, /grid-template-columns:300px minmax\(0,1fr\)/);
  assert.match(css, /\.nt-inspector/);
});

test("notes inbox scope and hierarchy stay native", () => {
  const repo = read("src-tauri/src/database/repositories/notes.rs");
  const module = read("src/components/NotesModule.tsx");

  assert.match(repo, /"inbox" => conditions\.push\("t\.folder_id IS NULL"/);
  assert.match(module, /flattenFolders/);
  assert.match(module, /parentFolderId/);
  assert.match(module, /folderId:folderId\|\|null/);
});

test("notes sync materializes every registered note relation type", () => {
  const store = read("src-tauri/src/sync/store.rs");
  const outbox = read("src-tauri/src/sync/outbox.rs");
  const registry = read("vendor/shared/crates/lifetrace-contracts/src/registry.rs");

  for (const entity of [
    "note.folder",
    "note.note",
    "note.tag",
    "note.tag_relation",
    "note.relation",
    "note.revision",
  ]) {
    assert.match(registry, new RegExp(entity.replace(".", "\\.")));
  }

  assert.match(store, /"note\.relation" => connection\.query_row/);
  assert.match(store, /"note\.revision" => connection\.query_row/);
  assert.match(store, /"note\.tag_relation" => \{/);
  assert.match(store, /INSERT INTO note_relations/);
  assert.match(store, /INSERT INTO note_revisions/);
  assert.match(store, /note_links::sync_note_links/);
  assert.match(store, /DELETE FROM note_relations/);
  assert.match(store, /DELETE FROM note_revisions/);

  assert.match(outbox, /EntityType::NOTE_TAG_RELATION/);
  assert.match(outbox, /EntityType::NOTE_RELATION/);
  assert.match(outbox, /EntityType::NOTE_REVISION/);
  assert.match(outbox, /parentFolderId/);
});


test("daily notes persist web-compatible properties inside the note snapshot", () => {
  const notes = read("src/components/NotesModule.tsx");
  assert.match(notes, /status:"daily",source:"lifetrace",aliases:\[\]/);
  assert.match(notes, /withNoteProperties/);
  assert.match(notes, /readNoteProperties/);
  assert.match(notes, /contentJson:withNoteProperties/);
  assert.match(notes, /markdownContentJson/);
  assert.doesNotMatch(notes, /type:"doc",content:/);
});


test("notes graph reads the derived wiki-link index instead of business relations", () => {
  const links = read("src-tauri/src/database/note_links.rs");
  const app = read("src-tauri/src/application/notes.rs");
  const notes = read("src/components/NotesModule.tsx");

  assert.match(links, /pub fn graph\(connection: &Connection, limit: usize\)/);
  assert.match(links, /FROM note_links l/);
  assert.match(app, /"graph" => crate::database::note_links::graph/);
  assert.match(notes, /graph\.edges\.map/);
  assert.doesNotMatch(notes, /graphEdges=libraryNotes\.flatMap/);
});

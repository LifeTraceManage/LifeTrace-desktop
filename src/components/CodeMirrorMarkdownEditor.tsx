import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

export type MarkdownEditorHandle = {
  insertText(text: string): void;
  selectedText(): string;
  focusHeading(text: string): void;
};
type Props = { value: string; onChange(value: string): void };

class PreviewWidget extends WidgetType {
  constructor(readonly label: string, readonly kind: "bullet" | "task" | "image", readonly from = 0, readonly checked = false, readonly src = "") { super(); }
  eq(other: PreviewWidget) { return this.label === other.label && this.kind === other.kind && this.from === other.from && this.checked === other.checked && this.src === other.src; }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "nt-cm-widget";
    if (this.kind === "bullet") el.textContent = "•";
    if (this.kind === "task") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = this.checked;
      input.setAttribute("aria-label", "切换待办状态");
      input.addEventListener("mousedown", event => event.stopPropagation());
      input.addEventListener("change", () => {
        const text = view.state.doc.sliceString(this.from, this.from + 5);
        if (!/^[-*+] \[[ xX]\]/.test(text)) return;
        view.dispatch({ changes: { from: this.from + 3, to: this.from + 4, insert: input.checked ? "x" : " " } });
      });
      el.appendChild(input);
    }
    if (this.kind === "image") {
      if (/^https?:\/\//i.test(this.src)) {
        const img = document.createElement("img");
        img.src = this.src;
        img.alt = this.label;
        img.loading = "lazy";
        el.appendChild(img);
      } else {
        // Attachment references remain in the raw document; a safe placeholder
        // is shown until they can be resolved through the desktop file API.
        el.textContent = this.label || "附件图片";
        el.title = this.src;
      }
    }
    return el;
  }
  ignoreEvent() { return true; }
}
type Span = { from: number; to: number; decoration: Decoration };
const hidden = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });

/** Render only inactive lines; the cursor line always reveals literal syntax. */
function decorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const active = doc.lineAt(view.state.selection.main.head).number;
  const spans: Span[] = [];
  let fenced = false;
  const add = (from: number, to: number, decoration: Decoration) => {
    if (from >= 0 && from <= to && to <= doc.length) spans.push({ from, to, decoration });
  };
  const inline = (text: string, base: number) => {
    const used: Array<[number, number]> = [];
    const free = (a: number, b: number) => !used.some(([x, y]) => a < y && b > x);
    const take = (a: number, b: number) => used.push([a, b]);
    for (const m of text.matchAll(/!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+|attachment:\/\/[^\s)]+)\)/g)) {
      const a = m.index, b = a + m[0].length;
      if (!free(a, b)) continue;
      take(a, b);
      add(base + a, base + b, Decoration.replace({ widget: new PreviewWidget(m[1], "image", 0, false, m[2]) }));
    }
    for (const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\n]*)\)/g)) {
      const a = m.index, b = a + m[0].length;
      if (!free(a, b)) continue;
      take(a, b);
      add(base + a, base + a + 1, hidden);
      add(base + a + 1, base + a + 1 + m[1].length, mark("nt-cm-link"));
      add(base + a + 1 + m[1].length, base + b, hidden);
    }
    for (const m of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const a = m.index, b = a + m[0].length;
      if (!free(a, b)) continue;
      take(a, b);
      add(base + a, base + a + 2, hidden);
      add(base + a + 2, base + b - 2, mark("nt-cm-link"));
      add(base + b - 2, base + b, hidden);
    }
    const patterns: Array<[RegExp, string, number]> = [
      [/\*\*(.+?)\*\*/g, "nt-cm-strong", 2],
      [/__(.+?)__/g, "nt-cm-strong", 2],
      [/~~(.+?)~~/g, "nt-cm-strike", 2],
      [/\x60([^\x60\n]+)\x60/g, "nt-cm-code-inline", 1],
      [/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "nt-cm-em", 1],
      [/(?<!_)_([^_\n]+)_(?!_)/g, "nt-cm-em", 1],
    ];
    for (const [regex, cls, delimiter] of patterns) for (const m of text.matchAll(regex)) {
      const a = m.index, b = a + m[0].length;
      if (!free(a, b)) continue;
      take(a, b);
      add(base + a, base + a + delimiter, hidden);
      add(base + a + delimiter, base + b - delimiter, mark(cls));
      add(base + b - delimiter, base + b, hidden);
    }
  };
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n), text = line.text;
    const fence = /^ {0,3}(\x60{3,}|~{3,})/.test(text);
    if (fence) {
      if (n !== active) add(line.from, line.to, mark("nt-cm-fence"));
      fenced = !fenced;
      continue;
    }
    if (fenced) { add(line.from, line.to, mark("nt-cm-code-line")); continue; }
    if (n === active) continue;
    const heading = /^(#{1,6})\s+/.exec(text);
    if (heading) {
      add(line.from, line.from, Decoration.line({ attributes: { class: "nt-cm-heading nt-cm-h" + heading[1].length } }));
      add(line.from, line.from + heading[0].length, hidden);
    }
    const quote = /^(\s*>\s?)/.exec(text);
    if (quote) {
      add(line.from, line.from, Decoration.line({ attributes: { class: "nt-cm-quote" } }));
      add(line.from, line.from + quote[0].length, hidden);
    }
    const task = /^(\s*)([-*+] \[[ xX]\]\s)/.exec(text);
    if (task) {
      const from = line.from + task[1].length;
      add(from, from + task[2].length, Decoration.replace({
        widget: new PreviewWidget("", "task", from, /[xX]/.test(task[2][3])),
      }));
    } else {
      const bullet = /^(\s*)([-*+]\s)/.exec(text);
      if (bullet) {
        const from = line.from + bullet[1].length;
        add(from, from + bullet[2].length, Decoration.replace({ widget: new PreviewWidget("•", "bullet") }));
      }
    }
    inline(text, line.from);
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(spans.map(span => span.decoration.range(span.from, span.to)), true);
}

const preview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = decorations(update.view);
  }
}, { decorations: plugin => plugin.decorations });

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent" },
  ".cm-scroller": { overflow: "visible", fontFamily: "inherit" },
  ".cm-content": { minHeight: "55vh", fontFamily: "inherit", caretColor: "var(--hx-accent2, #176b54)" },
  ".cm-line": { padding: "2px 0" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" },
});

const CodeMirrorMarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function CodeMirrorMarkdownEditor({ value, onChange }, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbackRef = useRef(onChange);
  const emittedRef = useRef<string | null>(null);
  callbackRef.current = onChange;
  useEffect(() => {
    if (!mountRef.current) return;
    const view = new EditorView({
      parent: mountRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          markdown(), history(), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping, theme, preview,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            const next = update.state.doc.toString();
            emittedRef.current = next;
            callbackRef.current(next);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
    // The keyed NoteEditor remounts when switching notes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === emittedRef.current || value === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    emittedRef.current = value;
  }, [value]);
  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
      view.focus();
    },
    selectedText() {
      const view = viewRef.current;
      if (!view) return "";
      const { from, to } = view.state.selection.main;
      return view.state.doc.sliceString(from, to).trim();
    },
    focusHeading(text: string) {
      const view = viewRef.current;
      if (!view) return;
      for (let n = 1; n <= view.state.doc.lines; n++) {
        const line = view.state.doc.line(n);
        const match = /^#{1,6}\s+(.+)$/.exec(line.text);
        if (match && match[1].trim() === text.trim()) {
          view.dispatch({ selection: { anchor: line.from + match[0].length - match[1].length }, scrollIntoView: true });
          view.focus();
          return;
        }
      }
    },
  }), []);
  return <div ref={mountRef} className="nt-cm-editor" data-testid="markdown-rich-editor" aria-label="Markdown 实时渲染编辑器" />;
});
export default CodeMirrorMarkdownEditor;

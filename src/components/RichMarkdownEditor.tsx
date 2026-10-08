import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import remarkGfm from "remark-gfm";
import TurndownService from "turndown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";

export type RichMarkdownEditorHandle = {
  insertText: (text: string) => void;
  selectedText: () => string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
};

function toHtml(markdown: string): string {
  // ReactMarkdown escapes raw HTML by default, so imported Markdown cannot
  // introduce arbitrary HTML into Tiptap.
  const html = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>,
  );
  // GFM task lists use class names and disabled inputs; Tiptap requires
  // data-type attributes. Normalize the safe renderer output before parsing.
  return html
    .replace(/<ul class="contains-task-list">/g, '<ul data-type="taskList">')
    .replace(/<li class="task-list-item">([\\s\\S]*?)<\\/li>/g, (_match, inner: string) => {
      const checked = /<input\\b[^>]*\\bchecked(?:=""|(?=\\s|>))/.test(inner);
      return '<li data-type="taskItem" data-checked="' + checked + '">' +
        inner.replace(/<input\\b[^>]*>/, "") + '</li>';
    });
}

function toMarkdown(html: string): string {
  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  converter.addRule("taskItems", {
    filter: (node) => node.nodeName === "LI" &&
      node.querySelector(":scope > label input[type=checkbox], :scope > input[type=checkbox]") !== null,
    replacement: (_content, node) => {
      const element = node as HTMLElement;
      const input = element.querySelector("input[type=checkbox]") as HTMLInputElement | null;
      const checked = input?.checked || input?.hasAttribute("checked");
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input[type=checkbox]").forEach(item => item.remove());
      const inner = converter.turndown(clone.innerHTML).trim().replace(/^[-*+]\s*/, "");
      return "\n- [" + (checked ? "x" : " ") + "] " + inner + "\n";
    },
  });
  return converter.turndown(html).trimEnd();
}

/** Rich editing never touches contentMarkdown outside onChange. */
const RichMarkdownEditor = forwardRef<RichMarkdownEditorHandle, Props>(function RichMarkdownEditor({ value, onChange }, ref) {
  const onChangeRef = useRef(onChange);
  const lastEmitted = useRef<string | null>(null);
  onChangeRef.current = onChange;

  const editor = useEditor({
    immediatelyRender: false,
    content: toHtml(value),
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "开始写下你的想法… 支持 Markdown 快捷输入" }),
    ],
    editorProps: {
      attributes: { class: "nt-rich-content", "aria-label": "笔记实时编辑区", spellcheck: "true" },
    },
    onUpdate({ editor: instance }) {
      const next = toMarkdown(instance.getHTML());
      lastEmitted.current = next;
      onChangeRef.current(next);
    },
  });

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      editor?.chain().focus().insertContent(text).run();
    },
    selectedText() {
      if (!editor) return "";
      const { from, to } = editor.state.selection;
      return editor.state.doc.textBetween(from, to, "\n").trim();
    },
  }), [editor]);

  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    const nextHtml = toHtml(value);
    if (editor.getHTML() !== nextHtml) editor.commands.setContent(nextHtml, { emitUpdate: false });
    lastEmitted.current = value;
  }, [editor, value]);

  if (!editor) return <div className="nt-rich-loading">正在加载编辑器…</div>;
  return <div className="nt-rich-editor" data-testid="markdown-rich-editor">
    <div className="nt-rich-toolbar" role="toolbar" aria-label="正文格式">
      <button type="button" aria-label="粗体" className={editor.isActive("bold") ? "active" : ""} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
      <button type="button" aria-label="斜体" className={editor.isActive("italic") ? "active" : ""} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button type="button" aria-label="标题" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H₂</button>
      <button type="button" aria-label="列表" onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
      <button type="button" aria-label="任务" onClick={() => editor.chain().focus().toggleTaskList().run()}>☑</button>
      <button type="button" aria-label="引用" onClick={() => editor.chain().focus().toggleBlockquote().run()}>❞</button>
      <button type="button" aria-label="代码" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{"</>"}</button>
      <button type="button" aria-label="撤销" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>↶</button>
      <button type="button" aria-label="重做" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>↷</button>
    </div>
    <EditorContent editor={editor} />
  </div>;
});

export default RichMarkdownEditor;

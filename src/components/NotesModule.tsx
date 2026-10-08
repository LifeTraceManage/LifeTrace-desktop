"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/preserve-manual-memoization */

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive, ArchiveRestore, Bold, Braces, CalendarDays, CheckSquare2, ChevronRight, Command, Copy, Download,
  File, FileJson, FileText, FileUp, Folder, FolderPlus, Heading1, Heading2,
  History, ImagePlus, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, ListTree,
  Network, NotebookPen, Paperclip, Pin, Plus, Quote, Save, Search,
  Star, Strikethrough, Tag, Trash2, X,
} from "lucide-react";
import { noteApi, type NoteGraph, type NoteInputValue } from "@/src/services/noteApi";
import { noteFileApi, type CloudNoteAttachment } from "@/src/services/noteFileApi";
import { executionApi } from "@/src/services/executionApi";
import { desktopNotes } from "@/src/desktop/noteAdapter";
import { useLifeStore } from "@/src/stores/useLifeStore";
import type { Note, NoteFolder, NoteRelation, NoteRevision, NoteTag, NoteType } from "@/src/types";
import MoreMenu from "@/src/ui/menu/MoreMenu";
import type { AppAction } from "@/src/ui/actions/types";

const labels:Record<NoteType,string>={quick:"快速记录",document:"普通笔记",daily:"每日复盘",habit_log:"习惯记录",workout_review:"训练复盘",expense_note:"消费笔记",weekly_review:"周总结",monthly_review:"月总结"};
const emptyJson={type:"markdown",source:"",editor:"desktop-markdown",properties:{status:"",source:"",aliases:[]}};
const plainTextFromMarkdown=(markdown:string)=>markdown
  .replace(/```[\s\S]*?```/g,block=>block.replace(/^```[^\n]*\n?|```$/g," "))
  .replace(/!\[([^\]]*)\]\([^)]*\)/g,"$1")
  .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_match,target:string,label?:string)=>(label||target).trim())
  .replace(/^\s{0,3}#{1,6}\s+/gm,"")
  .replace(/^\s*>\s?/gm,"")
  .replace(/^\s*[-+*]\s+(?:\[[ xX]\]\s*)?/gm,"")
  .replace(/^\s*\d+[.)]\s+/gm,"")
  .replace(/\*\*|__|~~|`|\*/g,"")
  .replace(/<[^>]+>/g," ")
  .replace(/\s+/g," ")
  .trim();
const cleanSummary=(text:string)=>text.trim().replace(/\s+/g," ").slice(0,160);
const escapeHtml=(value:string)=>value.replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]??char));
const titleOf=(note:Pick<Note,"title"|"summary">)=>note.title?.trim()||note.summary?.trim().split("\n")[0]||"无标题笔记";
const formatTime=(value:string)=>new Intl.DateTimeFormat("zh-CN",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
const dayTitle=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const dailyTemplate=(day:string)=>{
  const markdown=`# ${day}\n\n## 今日记录\n\n## 待处理\n\n## 复盘\n`;
  return{
    markdown,
    text:`${day}\n今日记录\n待处理\n复盘`,
    html:"",
    json:withNoteProperties({type:"markdown",source:markdown,editor:"desktop-markdown"},{status:"daily",source:"lifetrace",aliases:[]}),
  };
};
const noteHeadings=(markdown:string)=>{
  const headings:Array<{level:number;text:string;index:number}>=[];
  const lines=markdown.split(/\r?\n/);let fenced=false;
  lines.forEach((line,index)=>{
    if(/^\s*(?:```|~~~)/.test(line)){fenced=!fenced;return}
    if(fenced)return;
    const match=/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if(!match)return;
    const text=plainTextFromMarkdown(match[2]).trim();
    if(text)headings.push({level:match[1].length,text,index});
  });
  return headings;
};
type DesktopNoteProperties={status:string;source:string;aliases:string[]};
const readNoteProperties=(value:unknown):DesktopNoteProperties=>{
  if(!value||typeof value!=="object"||Array.isArray(value))return{status:"",source:"",aliases:[]};
  const raw=(value as Record<string,unknown>).properties;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return{status:"",source:"",aliases:[]};
  const record=raw as Record<string,unknown>;
  return{
    status:typeof record.status==="string"?record.status:"",
    source:typeof record.source==="string"?record.source:"",
    aliases:Array.isArray(record.aliases)?[...new Set(record.aliases.filter((item):item is string=>typeof item==="string").map(item=>item.trim()).filter(Boolean))]:[],
  };
};
const withNoteProperties=(contentJson:Record<string,unknown>,properties:DesktopNoteProperties)=>({
  ...contentJson,
  properties:{status:properties.status.trim(),source:properties.source.trim(),aliases:properties.aliases},
});
const markdownSource=(note:Pick<Note,"contentJson"|"contentMarkdown"|"contentText">)=>{
  const jsonSource=note.contentJson&&typeof note.contentJson==="object"&&!Array.isArray(note.contentJson)
    &&typeof (note.contentJson as Record<string,unknown>).source==="string"
      ? String((note.contentJson as Record<string,unknown>).source)
      : "";
  return note.contentMarkdown||jsonSource||note.contentText||"";
};
const markdownContentJson=(markdown:string,current:Record<string,unknown>,properties:DesktopNoteProperties)=>withNoteProperties({
  ...current,type:"markdown",source:markdown,editor:"desktop-markdown",
},properties);
const flattenFolders=(folders:NoteFolder[])=>{
  const children=new Map<string|null,NoteFolder[]>();
  for(const folder of folders){const key=folder.parentFolderId??null;children.set(key,[...(children.get(key)??[]),folder])}
  for(const items of children.values())items.sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,"zh-CN"));
  const rows:Array<{folder:NoteFolder;depth:number}>=[];
  const visit=(parent:string|null,depth:number,path:Set<string>)=>{for(const folder of children.get(parent)??[]){if(path.has(folder.id))continue;rows.push({folder,depth});const next=new Set(path);next.add(folder.id);visit(folder.id,depth+1,next)}};
  visit(null,0,new Set());
  for(const folder of folders)if(!rows.some(row=>row.folder.id===folder.id))rows.push({folder,depth:0});
  return rows;
};
const notify=(message:string)=>window.dispatchEvent(new CustomEvent("hengxu-toast",{detail:message}));

type NoteWikiLink={id:string;targetNoteId:string|null;targetTitle:string;displayTitle:string;alias:string|null;resolved:boolean;createdAt:string};
type NoteBacklink={id:string;sourceNoteId:string;sourceTitle:string;sourceSummary:string;alias:string|null;createdAt:string};
type KnowledgeNote=Note&{wikiLinks?:NoteWikiLink[];backlinks?:NoteBacklink[]};

function useDebounced<T>(value:T,delay:number){
  const [result,setResult]=useState(value);
  useEffect(()=>{const timer=window.setTimeout(()=>setResult(value),delay);return()=>window.clearTimeout(timer)},[value,delay]);
  return result;
}

function EditorButton({title,active,onClick,children}:{title:string;active?:boolean;onClick:()=>void;children:React.ReactNode}){
  return <button type="button" title={title} aria-label={title} className={active?"active":""} onMouseDown={event=>{event.preventDefault();onClick()}}>{children}</button>;
}

function NoteEditor({note,folders,tags,onSaved,onListChanged,onOpenNote,trashMode,registerSave}:{note:Note;folders:NoteFolder[];tags:NoteTag[];onSaved:(note:Note)=>void;onListChanged:()=>void;onOpenNote:(id:string)=>Promise<void>;trashMode:boolean;registerSave:(save:(revision?:boolean)=>Promise<Note|null>)=>()=>void}){
  const store=useLifeStore();
  const [draft,setDraft]=useState(note);
  const [dirty,setDirty]=useState(false);
  const [status,setStatus]=useState<"saved"|"dirty"|"saving"|"failed">("saved");
  const [revisions,setRevisions]=useState<NoteRevision[]>([]);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [linkCandidates,setLinkCandidates]=useState<Note[]>([]);
  const [properties,setProperties]=useState<DesktopNoteProperties>(()=>readNoteProperties(note.contentJson));
  const [markdown,setMarkdown]=useState(()=>markdownSource(note));
  const [editorMode,setEditorMode]=useState<"split"|"source"|"preview">("source");
  const [showFormatting,setShowFormatting]=useState(false);
  const [showInspector,setShowInspector]=useState(false);
  const [inspectorTab,setInspectorTab]=useState<"outline"|"properties"|"links"|"relations"|"attachments">("outline");
  const [cloudAttachments,setCloudAttachments]=useState<CloudNoteAttachment[]>([]);
  const [cloudAttachmentLoading,setCloudAttachmentLoading]=useState(false);
  const editorRef=useRef<HTMLTextAreaElement>(null);
  const saveLock=useRef(false);

  const updateMarkdown=useCallback((value:string)=>{
    const plain=plainTextFromMarkdown(value);
    setMarkdown(value);
    setDraft(current=>({
      ...current,
      contentJson:markdownContentJson(value,current.contentJson,readNoteProperties(current.contentJson)),
      contentHtml:"",
      contentText:plain,
      contentMarkdown:value,
      summary:cleanSummary(plain),
    }));
    setDirty(true);setStatus("dirty");
  },[]);

  const save=useCallback(async(createRevision=false)=>{
    if(saveLock.current||!dirty&&!createRevision)return draft;
    saveLock.current=true;setStatus("saving");
    try{
      const value:NoteInputValue&{id:string}={
        id:draft.id,title:draft.title,noteType:draft.noteType,folderId:draft.folderId,
        contentJson:draft.contentJson,contentHtml:draft.contentHtml,
        contentText:draft.contentText,contentMarkdown:draft.contentMarkdown,summary:draft.summary,
        isPinned:draft.isPinned,isFavorite:draft.isFavorite,isArchived:draft.isArchived,
        tagIds:draft.tags.map(item=>item.id),relations:draft.relations,createRevision,
      };
      const saved=await noteApi.update(value);
      setDraft(saved);setDirty(false);setStatus("saved");onSaved(saved);return saved;
    }catch(error){setStatus("failed");notify(error instanceof Error?error.message:"保存失败");return null}
    finally{saveLock.current=false}
  },[dirty,draft,onSaved]);

  useEffect(()=>registerSave(save),[registerSave,save]);

  useEffect(()=>{if(!dirty)return;const timer=window.setTimeout(()=>void save(false),800);return()=>window.clearTimeout(timer)},[draft,dirty,save]);
  useEffect(()=>{
    const flush=()=>{if(dirty)void save(false)};
    const visibility=()=>{if(document.visibilityState==="hidden")flush()};
    window.addEventListener("blur",flush);
    document.addEventListener("visibilitychange",visibility);
    return()=>{window.removeEventListener("blur",flush);document.removeEventListener("visibilitychange",visibility)};
  },[dirty,save]);
  useEffect(()=>{
    let active=true;
    noteApi.list({scope:"all",sort:"title_asc",limit:250}).then(items=>{if(active)setLinkCandidates(items.filter(item=>item.id!==note.id))}).catch(()=>{if(active)setLinkCandidates([])});
    return()=>{active=false};
  },[note.id]);
  const reloadCloudAttachments=useCallback(async()=>{
    if(!noteFileApi.available()){setCloudAttachments([]);return}
    setCloudAttachmentLoading(true);
    try{setCloudAttachments(await noteFileApi.list(note.id))}
    catch{setCloudAttachments([])}
    finally{setCloudAttachmentLoading(false)}
  },[note.id]);
  useEffect(()=>{void reloadCloudAttachments()},[reloadCloudAttachments]);

  const patch=(value:Partial<Note>)=>{setDraft(current=>({...current,...value}));setDirty(true);setStatus("dirty")};
  const patchProperties=(value:Partial<DesktopNoteProperties>)=>{
    const next={...properties,...value};
    setProperties(next);
    setDraft(noteValue=>({...noteValue,contentJson:withNoteProperties(noteValue.contentJson,next)}));
    setDirty(true);setStatus("dirty");
  };
  const editSelection=(prefix:string,suffix=prefix,placeholder="文本")=>{
    const textarea=editorRef.current;if(!textarea)return;
    const start=textarea.selectionStart;const end=textarea.selectionEnd;
    const selected=markdown.slice(start,end)||placeholder;
    const next=`${markdown.slice(0,start)}${prefix}${selected}${suffix}${markdown.slice(end)}`;
    updateMarkdown(next);
    requestAnimationFrame(()=>{textarea.focus();textarea.setSelectionRange(start+prefix.length,start+prefix.length+selected.length)});
  };
  const prefixSelectionLines=(prefix:string)=>{
    const textarea=editorRef.current;if(!textarea)return;
    const start=markdown.lastIndexOf("\n",Math.max(0,textarea.selectionStart-1))+1;
    const nextBreak=markdown.indexOf("\n",textarea.selectionEnd);
    const end=nextBreak<0?markdown.length:nextBreak;
    const source=markdown.slice(start,end);
    const inserted=source.split("\n").map(line=>prefix+line).join("\n");
    updateMarkdown(markdown.slice(0,start)+inserted+markdown.slice(end));
    requestAnimationFrame(()=>{textarea.focus();textarea.setSelectionRange(start+prefix.length,start+inserted.length)});
  };
  const insertSnippet=(snippet:string)=>{
    const textarea=editorRef.current;if(!textarea)return;
    const start=textarea.selectionStart;const end=textarea.selectionEnd;
    const next=markdown.slice(0,start)+snippet+markdown.slice(end);
    updateMarkdown(next);
    requestAnimationFrame(()=>{textarea.focus();textarea.setSelectionRange(start+snippet.length,start+snippet.length)});
  };
  const toggleTag=(tag:NoteTag)=>patch({tags:draft.tags.some(x=>x.id===tag.id)?draft.tags.filter(x=>x.id!==tag.id):[...draft.tags,tag]});
  const loadHistory=async()=>{setRevisions(await noteApi.revisions(note.id));setHistoryOpen(true)};
  const action=async(kind:"trash"|"restore"|"delete"|"duplicate")=>{
    if(kind==="delete"&&!confirm("永久删除后无法恢复，确定继续吗？"))return;
    if(kind==="trash")await noteApi.trash(note.id);
    if(kind==="restore")await noteApi.restore(note.id);
    if(kind==="delete"){
      for(const attachment of cloudAttachments)await noteFileApi.remove(attachment.id).catch(()=>undefined);
      for(const attachment of note.attachments??[])await desktopNotes.deleteAttachment(note.id,attachment.fileName);
      await noteApi.delete(note.id);
    }
    if(kind==="duplicate")await noteApi.duplicate(note.id);
    notify(kind==="restore"?"笔记已恢复":kind==="duplicate"?"已创建副本":"操作已完成");onListChanged();
  };
  const exportNote=async(format:"md"|"html"|"json")=>{
    const content=format==="md"?draft.contentMarkdown:format==="html"?`<!doctype html><meta charset="utf-8"><title>${escapeHtml(titleOf(draft))}</title><pre>${escapeHtml(draft.contentMarkdown)}</pre>`:JSON.stringify(draft,null,2);
    if(desktopNotes.available()){const result=await desktopNotes.exportNote({format,title:titleOf(draft),content});if(!result.ok)notify(result.error||"导出失败")}
    else{const blob=new Blob([content],{type:"text/plain;charset=utf-8"});const anchor=document.createElement("a");anchor.href=URL.createObjectURL(blob);anchor.download=`${titleOf(draft)}.${format}`;anchor.click();URL.revokeObjectURL(anchor.href)}
  };
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();void save(true)}};
    window.addEventListener("keydown",key);
    const dispose=desktopNotes.onCommand(command=>{if(command==="save")void save(true);if(command==="favorite")patch({isFavorite:!draft.isFavorite});if(command==="pin")patch({isPinned:!draft.isPinned});if(command==="export")void exportNote("md");if(command==="trash")void action("trash")});
    return()=>{window.removeEventListener("keydown",key);dispose?.()};
  });
  const attachmentMarkdown=(file:{id:string;originalName:string;mimeType:string})=>{
    const safeName=file.originalName.replace(/[\[\]]/g,"");
    return file.mimeType.startsWith("image/")?`![${safeName}](attachment://${file.id})`:`[${safeName}](attachment://${file.id})`;
  };
  const refreshLocalAttachmentState=async()=>{
    const latest=await noteApi.get(note.id);setDraft(latest);setMarkdown(markdownSource(latest));setProperties(readNoteProperties(latest.contentJson));onSaved(latest);
  };
  const attach=async()=>{
    if(!desktopNotes.available()){notify("附件仅在 LifeTrace Desktop可用");return}
    const result=await desktopNotes.selectAttachment(note.id);if(!result.ok||!result.file){if(result.error)notify(result.error);return}
    const local=result.file as Record<string,unknown>;
    const localPath=typeof local.storagePath==="string"?local.storagePath:"";
    if(noteFileApi.available()&&localPath){
      try{
        const cloud=await noteFileApi.upload(note.id,localPath);
        await noteApi.recordAttachment({
          ...local,id:cloud.id,noteId:note.id,originalName:cloud.originalName,mimeType:cloud.mimeType,
          fileSize:cloud.sizeBytes,createdAt:cloud.createdAt,
        });
        setCloudAttachments(current=>[cloud,...current.filter(item=>item.id!==cloud.id)]);
        await refreshLocalAttachmentState();
        insertSnippet(attachmentMarkdown(cloud));
        notify("附件已上传云端并插入引用");
        return;
      }catch(error){
        await noteApi.recordAttachment(local);
        await refreshLocalAttachmentState();
        notify(`附件已保存在本机；云端上传失败：${error instanceof Error?error.message:String(error)}`);
        return;
      }
    }
    await noteApi.recordAttachment(local);await refreshLocalAttachmentState();notify("附件已添加到本机");
  };
  const downloadCloudAttachment=async(file:CloudNoteAttachment)=>{
    try{
      const local=await noteFileApi.download(note.id,file.id);
      await noteApi.recordAttachment(local);
      await refreshLocalAttachmentState();
      await desktopNotes.openAttachment(note.id,local.fileName);
    }catch(error){notify(error instanceof Error?error.message:"下载附件失败")}
  };
  const deleteAttachment=async(file:{id:string;fileName?:string},cloud:boolean)=>{
    if(!confirm("删除这个附件吗？"))return;
    if(cloud)await noteFileApi.remove(file.id);
    if(file.fileName)await desktopNotes.deleteAttachment(note.id,file.fileName);
    await noteApi.deleteAttachment(file.id).catch(()=>undefined);
    setCloudAttachments(current=>current.filter(item=>item.id!==file.id));
    await refreshLocalAttachmentState();
  };
  const insertWikiLink=(value:string)=>{
    const target=linkCandidates.find(item=>item.id===value);if(!target)return;
    const safeTitle=titleOf(target).replace(/\|/g,"／").replace(/\]\]/g,"］］");
    insertSnippet(`[[${safeTitle}]]`);
  };
  const relationOptions=[
    ...store.activities.map(x=>({type:"habit.activity",id:x.id,label:`习惯 · ${x.name}`})),
    ...store.workoutHistory.slice(0,20).map(x=>({type:"workout.workout",id:x.id,label:`训练 · ${x.name}`})),
    ...store.transactions.slice(0,30).map(x=>({type:"finance.transaction",id:x.id,label:`账单 · ${x.counterparty||x.category} · ¥${x.amount}`})),
  ];
  const addRelation=(value:string)=>{if(!value)return;const [entityType,entityId]=value.split(":");if(draft.relations.some(x=>x.entityType===entityType&&x.entityId===entityId))return;patch({relations:[...draft.relations,{id:crypto.randomUUID(),noteId:note.id,entityType:entityType as NoteRelation["entityType"],entityId,relationType:"reference",createdAt:new Date().toISOString()}]})};
  const knowledge=draft as KnowledgeNote;
  const wikiLinks=knowledge.wikiLinks??[];
  const backlinks=knowledge.backlinks??[];
  const createTaskFromNote=async()=>{
    const sourceText=markdown.trim()||draft.contentText.trim();
    const textarea=editorRef.current;
    const selection=textarea?markdown.slice(textarea.selectionStart,textarea.selectionEnd).trim():"";
    const selectedText=selection||sourceText;
    const title=(selection?cleanSummary(selection).split("\n")[0]:titleOf(draft)).slice(0,160)||"处理笔记";
    const saved=dirty?await save(false):draft;
    if(!saved)return;
    try{
      const task=await executionApi.tasks.create({
        title,
        description:`${selectedText.slice(0,4000)}\n\nSource: notes://note/${draft.id}`,
        context:"inbox",
      });
      await executionApi.relations.create({
        sourceType:"note.note",
        sourceId:draft.id,
        relationType:"converted_to",
        targetType:"execution.task",
        targetId:task.id,
      });
      notify(selection?"已从选中文本创建 Task":"已从当前笔记创建 Task");
    }catch(error){notify(error instanceof Error?error.message:"创建 Task 失败")}
  };
  const editorActions:AppAction<Note>[]=[
    {id:"duplicate",label:"复制笔记",icon:Copy,group:"primary",execute:()=>action("duplicate")},
    {id:"export-md",label:"导出 Markdown",icon:FileText,group:"related",execute:()=>exportNote("md")},
    {id:"export-html",label:"导出 HTML",icon:File,group:"related",execute:()=>exportNote("html")},
    {id:"export-json",label:"导出 JSON",icon:FileJson,group:"related",execute:()=>exportNote("json")},
    {id:"trash",label:"移到回收站",icon:Trash2,group:"danger",danger:true,execute:()=>action("trash")},
  ];

  if(trashMode)return <section className="nt-editor nt-trash-preview"><div><Trash2/><h2>{titleOf(draft)}</h2><p>{draft.summary||"这篇笔记没有摘要。"}</p><small>删除于 {draft.deletedAt?formatTime(draft.deletedAt):"未知时间"}</small><footer><button className="hx-btn primary" onClick={()=>void action("restore")}><ArchiveRestore/>恢复笔记</button><button className="hx-btn secondary danger" onClick={()=>void action("delete")}><Trash2/>永久删除</button></footer></div></section>;

  const localAttachmentIds=new Set((draft.attachments??[]).map(file=>file.id));
  const remoteOnlyAttachments=cloudAttachments.filter(file=>!localAttachmentIds.has(file.id));
  const headings=noteHeadings(markdown);
  const wordCount=plainTextFromMarkdown(markdown).replace(/\s+/g,"").length;
  const focusHeading=(lineIndex:number)=>{
    const textarea=editorRef.current;if(!textarea)return;
    const lines=markdown.split(/\r?\n/);
    const start=lines.slice(0,lineIndex).reduce((sum,line)=>sum+line.length+1,0);
    const end=start+(lines[lineIndex]?.length??0);
    textarea.focus();textarea.setSelectionRange(start,end);
    textarea.scrollTop=Math.max(0,lineIndex*27-textarea.clientHeight/3);
  };

  return <section className="nt-editor">
    <header className="nt-editor-head">
      <div className="nt-editor-status">
        <span className={`nt-save-state ${status}`}>{status==="saving"?"正在保存":status==="dirty"?"未保存":status==="failed"?"保存失败":"已保存"}</span>
        <span>{wordCount} 字</span>
      </div>
      <div>
          <button title="格式工具栏" aria-pressed={showFormatting} className={showFormatting?"active":""} onClick={()=>setShowFormatting(value=>!value)}><Bold/></button>
          <button title="切换编辑和阅读" onClick={()=>setEditorMode(value=>value==="preview"?"source":"preview")}><FileText/></button>
          <button title="切换侧栏" aria-expanded={showInspector} className={showInspector?"active":""} onClick={()=>setShowInspector(value=>!value)}><ListTree/></button>
        <MoreMenu actions={[{id:"save",label:"保存版本",icon:Save,group:"primary",execute:async()=>{await save(true)}},{id:"favorite",label:draft.isFavorite?"取消收藏":"收藏笔记",icon:Star,group:"primary",execute:()=>patch({isFavorite:!draft.isFavorite})},{id:"pin",label:draft.isPinned?"取消置顶":"置顶笔记",icon:Pin,group:"primary",execute:()=>patch({isPinned:!draft.isPinned})},{id:"task",label:"创建 Task",icon:CheckSquare2,group:"related",execute:()=>createTaskFromNote()},{id:"history",label:"版本历史",icon:History,group:"related",execute:()=>loadHistory()},...editorActions]} context={draft} label="更多笔记操作" buttonClassName="nt-more-button"/>
      </div>
    </header>
    <div className={`nt-editor-body ${showInspector?"nt-inspector-open":""}`}>
      <main className="nt-editor-main">
        <div className="nt-editor-scroll">
          <input className="nt-title" value={draft.title??""} onChange={e=>patch({title:e.target.value||null})} placeholder={draft.noteType==="quick"?"快速记录无需标题":"无标题笔记"}/>
          {showFormatting&&<div className="nt-formatbar">
            <EditorButton title="一级标题" onClick={()=>prefixSelectionLines("# ")}><Heading1/></EditorButton>
            <EditorButton title="二级标题" onClick={()=>prefixSelectionLines("## ")}><Heading2/></EditorButton>
            <EditorButton title="加粗" onClick={()=>editSelection("**","**","粗体文本")}><Bold/></EditorButton>
            <EditorButton title="斜体" onClick={()=>editSelection("_","_","斜体文本")}><Italic/></EditorButton>
            <EditorButton title="删除线" onClick={()=>editSelection("~~","~~","删除线文本")}><Strikethrough/></EditorButton>
            <EditorButton title="行内代码" onClick={()=>editSelection("`","`","code")}><Braces/></EditorButton>
            <EditorButton title="引用" onClick={()=>prefixSelectionLines("> ")}><Quote/></EditorButton>
            <EditorButton title="无序列表" onClick={()=>prefixSelectionLines("- ")}><List/></EditorButton>
            <EditorButton title="有序列表" onClick={()=>prefixSelectionLines("1. ")}><ListOrdered/></EditorButton>
            <EditorButton title="待办列表" onClick={()=>prefixSelectionLines("- [ ] ")}><ListChecks/></EditorButton>
            <EditorButton title="链接" onClick={()=>{const href=prompt("输入链接地址","https://");if(href)editSelection("[",`](${href})`,"链接文字")}}><LinkIcon/></EditorButton>
            <EditorButton title="图片链接" onClick={()=>{const src=prompt("输入图片的 HTTPS 地址","https://");if(src?.startsWith("https://"))insertSnippet(`![图片](${src})`)}}><ImagePlus/></EditorButton>
            <EditorButton title="代码块" onClick={()=>editSelection("\`\`\`\n","\n\`\`\`","代码")}><Braces/></EditorButton>
            <EditorButton title="表格" onClick={()=>insertSnippet("\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n")}><ListTree/></EditorButton>
          </div>}
          <div className="nt-view-switch" role="group" aria-label="编辑显示模式">
            {(["source","preview","split"] as const).map(mode=><button key={mode} type="button" className={editorMode===mode?"active":""} aria-pressed={editorMode===mode} onClick={()=>setEditorMode(mode)}>{mode==="source"?"编辑":mode==="preview"?"阅读":"分屏"}</button>)}
          </div>
          <div className={`nt-edit-layout nt-mode-${editorMode}`}>
          {editorMode!=="preview"&&<textarea
            ref={editorRef}
            className="nt-markdown-editor"
            data-testid="markdown-editor"
            value={markdown}
            onChange={event=>updateMarkdown(event.target.value)}
            placeholder="开始写下你的想法…支持 Markdown 与 [[Wiki Link]]"
            spellCheck
            onKeyDown={event=>{
              if(event.key==="Tab"){
                event.preventDefault();
                const field=event.currentTarget;
                const start=field.selectionStart,end=field.selectionEnd;
                updateMarkdown(markdown.slice(0,start)+"  "+markdown.slice(end));
                requestAnimationFrame(()=>{field.focus();field.setSelectionRange(start+2,start+2)});
              }
            }}
          />}
          {editorMode!=="source"&&<div className="nt-markdown-preview" data-testid="markdown-live-preview" aria-label="Markdown 实时渲染预览">
            <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url=>/^(https?:|mailto:|attachment:|#|\/)/i.test(url)?url:""} components={{
              a:({href,children})=>href?.startsWith("attachment:")?<span title={href}>{children}</span>:<a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
              img:({src,alt})=>src?.startsWith("attachment:")?<span className="nt-preview-attachment">{alt||"附件图片"}（在附件列表查看）</span>:<img src={src} alt={alt||""} loading="lazy" />,
            }}>{markdown}</ReactMarkdown>
          </div>}
          </div>
        </div>
      </main>
      {showInspector&&<aside className="nt-inspector" data-testid="notes-inspector">
         <nav className="nt-inspector-tabs" aria-label="侧栏视图">{(["outline","properties","links","relations","attachments"] as const).map(tab=><button type="button" key={tab} className={inspectorTab===tab?"active":""} aria-pressed={inspectorTab===tab} onClick={()=>setInspectorTab(tab)}>{({outline:"大纲",properties:"属性",links:"链接",relations:"关联",attachments:"附件"} as const)[tab]}</button>)}</nav>
        {inspectorTab==="outline"&&<section className="nt-inspector-section">
          <header><ListTree/><strong>大纲</strong><span>{headings.length}</span></header>
          <nav className="nt-outline">{headings.length?headings.map(heading=><button key={`${heading.index}:${heading.text}`} style={{paddingLeft:`${8+(heading.level-1)*12}px`}} className={heading.level===1?"level-1":""} onClick={()=>focusHeading(heading.index)}>{heading.text}</button>):<small>使用标题后，大纲会自动出现。</small>}</nav>
        </section>}
        {inspectorTab==="properties"&&<section className="nt-inspector-section">
          <header><Braces/><strong>属性</strong></header>
          <div className="nt-meta">
            <label><Folder/><span>文件夹</span><select value={draft.folderId??""} onChange={e=>patch({folderId:e.target.value||null})}><option value="">Inbox</option>{flattenFolders(folders).map(({folder,depth})=><option key={folder.id} value={folder.id}>{`${"— ".repeat(depth)}${folder.name}`}</option>)}</select></label>
            <label><FileText/><span>类型</span><select value={draft.noteType} onChange={e=>patch({noteType:e.target.value as NoteType})}>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
            <div className="nt-tag-field"><span><Tag/>标签</span><div>{tags.length?tags.map(tag=><button key={tag.id} className={draft.tags.some(x=>x.id===tag.id)?"active":""} style={{"--tag-color":tag.color} as React.CSSProperties} onClick={()=>toggleTag(tag)}>#{tag.name}</button>):<small>暂无标签</small>}</div></div>
            <label><Braces/><span>Status</span><input value={properties.status} onChange={e=>patchProperties({status:e.target.value})} placeholder="例如 draft"/></label>
            <label><LinkIcon/><span>Source</span><input value={properties.source} onChange={e=>patchProperties({source:e.target.value})} placeholder="例如 lifetrace"/></label>
            <label><Tag/><span>Aliases</span><input value={properties.aliases.join(", ")} onChange={e=>patchProperties({aliases:e.target.value.split(",").map(item=>item.trim()).filter(Boolean)})} placeholder="别名，用逗号分隔"/></label>
            <footer>创建 {formatTime(draft.createdAt)}<br/>更新 {formatTime(draft.updatedAt)} · v{draft.version}</footer>
          </div>
        </section>}
        {inspectorTab==="links"&&<section className="nt-inspector-section">
          <header><LinkIcon/><strong>知识链接</strong><span>{wikiLinks.length+backlinks.length}</span></header>
          <label className="nt-inspector-select"><span>插入 Wiki Link</span><select value="" onChange={e=>insertWikiLink(e.target.value)}><option value="">选择笔记…</option>{linkCandidates.map(item=><option key={item.id} value={item.id}>{titleOf(item)}</option>)}</select></label>
          <div className="nt-link-list"><strong>Links</strong>{wikiLinks.length?wikiLinks.map(link=><button key={link.id} disabled={!link.targetNoteId} onClick={()=>{if(link.targetNoteId)void onOpenNote(link.targetNoteId)}}>{link.resolved?"↗":"×"} {link.alias?link.alias:link.displayTitle}</button>):<small>正文输入 [[笔记标题]] 建立链接。</small>}</div>
          <div className="nt-link-list"><strong>Backlinks</strong>{backlinks.length?backlinks.map(link=><button key={link.id} onClick={()=>void onOpenNote(link.sourceNoteId)}>↩ {link.sourceTitle}</button>):<small>暂无反向链接</small>}</div>
        </section>}
        {inspectorTab==="relations"&&<section className="nt-inspector-section">
          <header><LinkIcon/><strong>关联数据</strong></header>
          <label className="nt-inspector-select"><select value="" onChange={e=>addRelation(e.target.value)}><option value="">添加习惯、训练或账单…</option>{relationOptions.map(x=><option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>{x.label}</option>)}</select></label>
          {draft.relations.length>0&&<div className="nt-relations">{draft.relations.map(rel=><span key={rel.id}>{rel.entityType} · {rel.entityId.slice(0,8)}<button onClick={()=>patch({relations:draft.relations.filter(x=>x.id!==rel.id)})}><X/></button></span>)}</div>}
        </section>}
        {inspectorTab==="attachments"&&<section className="nt-inspector-section nt-attachments">
          <header><span><Paperclip/><strong>附件</strong></span><button onClick={()=>void attach()}><Plus/>添加</button></header>
          {cloudAttachmentLoading&&<small>正在读取云附件…</small>}
          {(draft.attachments??[]).map(file=>{const cloud=cloudAttachments.some(item=>item.id===file.id);return <article key={file.id}><File/><div><strong>{file.originalName}</strong><small>{(file.fileSize/1024).toFixed(1)} KB · {cloud?"云端 + 本机":"仅本机"}</small></div><button onClick={()=>void desktopNotes.openAttachment(note.id,file.fileName)}>打开</button>{cloud&&<button title="插入附件引用" onClick={()=>{const remote=cloudAttachments.find(item=>item.id===file.id);if(remote)insertSnippet(attachmentMarkdown(remote))}}><Plus/></button>}<button className="danger" onClick={()=>void deleteAttachment(file,cloud)}><Trash2/></button></article>})}
          {remoteOnlyAttachments.map(file=><article key={file.id}><Download/><div><strong>{file.originalName}</strong><small>{(file.sizeBytes/1024).toFixed(1)} KB · 云端</small></div><button onClick={()=>void downloadCloudAttachment(file)}>下载</button><button title="插入附件引用" onClick={()=>insertSnippet(attachmentMarkdown(file))}><Plus/></button><button className="danger" onClick={()=>void deleteAttachment({id:file.id},true)}><Trash2/></button></article>)}
          {!cloudAttachmentLoading&&!(draft.attachments?.length)&&!remoteOnlyAttachments.length&&<small>暂无附件</small>}
        </section>}
      </aside>}
    </div>
    {historyOpen&&<aside className="nt-history"><header><div><History/><strong>版本历史</strong></div><button onClick={()=>setHistoryOpen(false)}><X/></button></header>{revisions.length===0?<p>手动保存后会在这里保留快照。</p>:revisions.map(revision=><article key={revision.id}><div><strong>版本 {revision.version}</strong><small>{formatTime(revision.createdAt)}</small></div><p>{revision.contentMarkdown.slice(0,120)||"空白版本"}</p><button onClick={async()=>{if(!confirm("恢复此版本？当前内容会先保存为快照。"))return;const restored=await noteApi.restoreRevision(revision.id);onSaved(restored);setDraft(restored);setMarkdown(markdownSource(restored));setProperties(readNoteProperties(restored.contentJson));setHistoryOpen(false);notify("历史版本已恢复")}}>恢复</button></article>)}</aside>}
  </section>;
}

export default function NotesModule(){
  const [scope,setScope]=useState("all");
  const [folderId,setFolderId]=useState("");
  const [tagId,setTagId]=useState("");
  const [query,setQuery]=useState("");
  const [sort,setSort]=useState("updated_desc");
  const [notes,setNotes]=useState<Note[]>([]);
  const [libraryNotes,setLibraryNotes]=useState<Note[]>([]);
  const [folders,setFolders]=useState<NoteFolder[]>([]);
  const [tags,setTags]=useState<NoteTag[]>([]);
  const [selected,setSelected]=useState<Note|null>(null);
  const [openedIds,setOpenedIds]=useState<string[]>([]);
  const [loading,setLoading]=useState(true);
  const [commandOpen,setCommandOpen]=useState(false);
  const [graphOpen,setGraphOpen]=useState(false);
  const [graphLoading,setGraphLoading]=useState(false);
  const [graph,setGraph]=useState<NoteGraph>({nodes:[],edges:[]});
  const saveBeforeSwitch=useRef<((revision?:boolean)=>Promise<Note|null>)|null>(null);
  const selectedIdRef=useRef<string|null>(null);
  const debouncedQuery=useDebounced(query,300);
  const searchRef=useRef<HTMLInputElement>(null);
  const folderRows=flattenFolders(folders);

  useEffect(()=>{
    try{
      const stored=JSON.parse(window.localStorage.getItem("lifetrace:notes:tabs")||"[]");
      if(Array.isArray(stored))setOpenedIds(stored.filter((value):value is string=>typeof value==="string").slice(0,12));
    }catch{setOpenedIds([])}
  },[]);
  useEffect(()=>{window.localStorage.setItem("lifetrace:notes:tabs",JSON.stringify(openedIds.slice(0,12)))},[openedIds]);

  const loadMeta=useCallback(async()=>{const meta=await noteApi.meta();setFolders(meta.folders);setTags(meta.tags)},[]);
  const loadList=useCallback(async(preferId?:string)=>{
    setLoading(true);
    try{
      const [list,all]=await Promise.all([
        noteApi.list({q:debouncedQuery,scope,folderId,tagId,sort,limit:150}),
        noteApi.list({scope:"all",sort:"updated_desc",limit:250}),
      ]);
      setNotes(list);setLibraryNotes(all);
      const target=preferId||selectedIdRef.current||window.localStorage.getItem("lifetrace:last-note")||list[0]?.id;
      if(target){
        try{
          const full=await noteApi.get(target);
          setSelected(full);selectedIdRef.current=target;
          setOpenedIds(current=>current.includes(target)?current:[...current,target].slice(-12));
          window.localStorage.setItem("lifetrace:last-note",target);
        }catch{
          const fallback=list[0];
          if(fallback){const full=await noteApi.get(fallback.id);setSelected(full);selectedIdRef.current=fallback.id}
          else{setSelected(null);selectedIdRef.current=null}
        }
      }else{setSelected(null);selectedIdRef.current=null}
    }catch(error){notify(error instanceof Error?error.message:"笔记加载失败")}finally{setLoading(false)}
  },[debouncedQuery,folderId,scope,sort,tagId]);
  useEffect(()=>{void loadMeta()},[loadMeta]);
  useEffect(()=>{void loadList()},[loadList]);

  const open=async(id:string)=>{
    if(selected?.id===id)return;
    await saveBeforeSwitch.current?.(false);
    const full=await noteApi.get(id);
    setSelected(full);selectedIdRef.current=id;
    setOpenedIds(current=>current.includes(id)?current:[...current,id].slice(-12));
    window.localStorage.setItem("lifetrace:last-note",id);
  };
  const create=useCallback(async(type:NoteType="document",seed?:Partial<NoteInputValue>)=>{
    const created=await noteApi.create({title:null,noteType:type,folderId:folderId||null,contentJson:emptyJson,contentHtml:"",contentText:"",contentMarkdown:"",summary:"",isPinned:false,isFavorite:false,isArchived:false,tagIds:[],relations:[],...seed});
    setScope("all");setTagId("");selectedIdRef.current=created.id;await loadList(created.id);setSelected(created);
    setOpenedIds(current=>current.includes(created.id)?current:[...current,created.id].slice(-12));
    notify(type==="quick"?"快速记录已创建":"新笔记已创建");
  },[folderId,loadList]);
  const openDailyNote=async()=>{
    const title=dayTitle();
    const candidates=await noteApi.list({scope:"all",sort:"updated_desc",limit:250});
    const fullMatches=await Promise.all(candidates.filter(item=>titleOf(item)===title).map(item=>noteApi.get(item.id)));
    const existing=fullMatches.find(item=>readNoteProperties(item.contentJson).status==="daily")??fullMatches[0];
    if(existing){await open(existing.id);return}
    const template=dailyTemplate(title);
    await create("daily",{title,contentJson:template.json,contentHtml:template.html,contentText:template.text,contentMarkdown:template.markdown,summary:cleanSummary(template.text)});
  };
  const importMarkdown=useCallback(async()=>{
    if(!desktopNotes.available()){notify("Markdown 导入仅在 LifeTrace Desktop可用");return}
    const result=await desktopNotes.importMarkdown();if(!result.ok||result.canceled)return;if(result.error){notify(result.error);return}
    const content=result.content??"";const plain=plainTextFromMarkdown(content);
    const contentJson=markdownContentJson(content,emptyJson,{status:"",source:"import",aliases:[]});
    await create("document",{title:result.title||null,contentJson,contentHtml:"",contentText:plain,contentMarkdown:content,summary:cleanSummary(plain)});
  },[create]);
  const refresh=useCallback(()=>void loadList(selectedIdRef.current??undefined),[loadList]);
  const showGraph=async()=>{
    setGraphOpen(true);setGraphLoading(true);
    try{setGraph(await noteApi.graph(80))}
    catch(error){notify(error instanceof Error?error.message:"知识图谱加载失败")}
    finally{setGraphLoading(false)}
  };

  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){setCommandOpen(false);setGraphOpen(false);return}
      if(!(event.ctrlKey||event.metaKey))return;
      if(event.key.toLowerCase()==="p"){event.preventDefault();setCommandOpen(true);return}
      if(event.key.toLowerCase()==="n"){event.preventDefault();void create(event.shiftKey?"quick":"document")}
      if(event.shiftKey&&event.key.toLowerCase()==="f"){event.preventDefault();searchRef.current?.focus()}
    };
    window.addEventListener("keydown",handler);
    const dispose=desktopNotes.onCommand(command=>{if(command==="new")void create("document");if(command==="quick")void create("quick");if(command==="import")void importMarkdown();if(command==="search")searchRef.current?.focus()});
    return()=>{window.removeEventListener("keydown",handler);dispose?.()};
  },[create,importMarkdown]);

  const makeFolder=async()=>{const name=prompt("文件夹名称");if(!name)return;await noteApi.saveFolder({name,icon:"folder",color:"#2a7a5e",sortOrder:folders.length,parentFolderId:folderId||null});await loadMeta()};
  const makeTag=async()=>{const name=prompt("标签名称");if(!name)return;await noteApi.saveTag({name,color:"#5f7d70"});await loadMeta()};
  const manageFolder=async(folder:NoteFolder)=>{const name=prompt("修改文件夹名称；留空并确定可删除（其中笔记会移到 Inbox）",folder.name);if(name===null)return;if(!name.trim()){if(confirm(`删除文件夹“${folder.name}”？笔记不会被删除。`))await noteApi.deleteFolder(folder.id)}else await noteApi.saveFolder({...folder,name:name.trim()});await loadMeta();await loadList()};
  const manageTag=async(tag:NoteTag)=>{const name=prompt("修改标签名称；留空并确定可删除",tag.name);if(name===null)return;if(!name.trim()){if(confirm(`删除标签“${tag.name}”？笔记不会被删除。`))await noteApi.deleteTag(tag.id)}else await noteApi.saveTag({...tag,name:name.trim()});await loadMeta();await loadList()};
  const restoreTrash=async()=>{for(const note of notes)await noteApi.restore(note.id);notify(`已恢复 ${notes.length} 篇笔记`);await loadList()};
  const emptyTrash=async()=>{if(!confirm(`永久删除回收站中的 ${notes.length} 篇笔记？此操作无法撤销。`))return;for(const item of notes){const full=await noteApi.get(item.id);for(const file of full.attachments??[])await desktopNotes.deleteAttachment(item.id,file.fileName);await noteApi.delete(item.id)}notify("回收站已清空");await loadList()};
  const toggleSelected=async(field:"isFavorite"|"isPinned")=>{if(!selected)return;const saved=await noteApi.update({...selected,[field]:!selected[field],tagIds:selected.tags.map(x=>x.id),relations:selected.relations,createRevision:false});setSelected(saved);setCommandOpen(false);await loadList(saved.id)};
  const exportSelected=async()=>{if(!selected)return;const content=selected.contentMarkdown||selected.contentText;if(desktopNotes.available())await desktopNotes.exportNote({format:"md",title:titleOf(selected),content});setCommandOpen(false)};
  const choose=(nextScope:string,nextFolder="",nextTag="")=>{setScope(nextScope);setFolderId(nextFolder);setTagId(nextTag)};
  const closeTab=async(id:string)=>{
    if(selected?.id===id)await saveBeforeSwitch.current?.(false);
    const remaining=openedIds.filter(value=>value!==id);setOpenedIds(remaining);
    if(selected?.id===id){
      const next=remaining[remaining.length-1];
      if(next)await open(next);else{setSelected(null);selectedIdRef.current=null}
    }
  };

  const inboxCount=libraryNotes.filter(note=>!note.folderId).length;
  const favoriteCount=libraryNotes.filter(note=>note.isFavorite).length;
  const pinnedCount=libraryNotes.filter(note=>note.isPinned).length;
  const builtin=[
    ["inbox","Inbox",NotebookPen,inboxCount],
    ["all","全部笔记",File,libraryNotes.length],
    ["recent","最近",History,Math.min(libraryNotes.length,30)],
    ["favorite","收藏",Star,favoriteCount],
    ["pinned","置顶",Pin,pinnedCount],
    ["archived","归档",Archive,0],
    ["trash","废纸篓",Trash2,0],
  ] as const;
  const activeLabel=folderId?folders.find(item=>item.id===folderId)?.name:tagId?`#${tags.find(item=>item.id===tagId)?.name??""}`:builtin.find(item=>item[0]===scope)?.[1]??"全部笔记";

  const graphPoints=graph.nodes.map((node,index)=>{const angle=graph.nodes.length<=1?0:Math.PI*2*index/graph.nodes.length-Math.PI/2;const radius=Math.min(180,90+graph.nodes.length*2);return{id:node.id,title:node.title,x:380+Math.cos(angle)*radius,y:220+Math.sin(angle)*radius,favorite:node.favorite}});
  const graphById=new Map(graphPoints.map(point=>[point.id,point]));
  const graphEdges=graph.edges.map(edge=>({source:graphById.get(edge.sourceId),target:graphById.get(edge.targetId)})).filter((edge):edge is {source:(typeof graphPoints)[number];target:(typeof graphPoints)[number]}=>Boolean(edge.source&&edge.target));

  return <><div className="nt-workspace" data-testid="notes-workspace">
    <aside className="nt-library" data-testid="notes-sidebar">
      <div className="nt-library-actions">
        <button className="primary" onClick={()=>void create("document")}><Plus/>新建笔记</button>
        <button title="Daily" onClick={()=>void openDailyNote()}><CalendarDays/></button>
        <button title="Graph" onClick={()=>void showGraph()}><Network/></button>
        <button title="命令" onClick={()=>setCommandOpen(true)}><Command/></button>
      </div>
      <div className="nt-search"><Search/><input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索标题、正文、文件夹或标签"/>{query&&<button onClick={()=>setQuery("")}><X/></button>}</div>
      <div className="nt-library-nav">
        <nav aria-label="笔记导航">{builtin.map(([id,label,Icon,count])=><button key={id} className={scope===id&&!folderId&&!tagId?"active":""} onClick={()=>choose(id)}><Icon/><span>{label}</span>{count>0&&<b>{count}</b>}</button>)}</nav>
        <section><header><span>Folders</span><button title="新建文件夹" onClick={()=>void makeFolder()}><FolderPlus/></button></header>{folderRows.length?folderRows.map(({folder,depth})=><button key={folder.id} style={{paddingLeft:`${10+depth*14}px`}} className={folderId===folder.id?"active":""} onClick={()=>choose("all",folder.id)} onContextMenu={event=>{event.preventDefault();void manageFolder(folder)}}><Folder/><span>{folder.name}</span></button>):<small>还没有文件夹</small>}</section>
        <section><header><span>Tags</span><button title="新建标签" onClick={()=>void makeTag()}><Plus/></button></header>{tags.length?tags.map(tag=><button key={tag.id} className={tagId===tag.id?"active":""} onClick={()=>choose("all","",tag.id)} onContextMenu={event=>{event.preventDefault();void manageTag(tag)}}><Tag/><span>{tag.name}</span></button>):<small>还没有标签</small>}</section>
      </div>
      <div className="nt-scope-head"><strong>{activeLabel}</strong><span>{notes.length} 篇</span></div>
      <div className="nt-list-toolbar">{scope==="trash"&&notes.length>0&&<><button title="恢复全部" onClick={()=>void restoreTrash()}><ArchiveRestore/></button><button title="清空回收站" onClick={()=>void emptyTrash()}><Trash2/></button></>}<select value={sort} onChange={e=>setSort(e.target.value)}><option value="updated_desc">最近编辑</option><option value="created_desc">最近创建</option><option value="created_asc">最早创建</option><option value="title_asc">标题 A–Z</option><option value="title_desc">标题 Z–A</option></select><button title="导入 Markdown" onClick={()=>void importMarkdown()}><FileUp/></button></div>
      <div className="nt-list-scroll">{loading?<p className="nt-list-empty">正在读取笔记…</p>:notes.length===0?<div className="nt-list-empty"><FileText/><strong>{query?"没有匹配的笔记":"这里还没有笔记"}</strong><p>创建一篇笔记，或调整搜索和筛选条件。</p></div>:notes.map(note=><button key={note.id} className={selected?.id===note.id?"active":""} onClick={()=>void open(note.id)}><header><strong>{titleOf(note)}</strong><span>{note.isPinned&&<Pin/>}{note.isFavorite&&<Star/>}</span></header><p>{note.summary||"暂无正文"}</p><footer><time>{formatTime(note.updatedAt)}</time>{note.folderId&&<span>· {folders.find(folder=>folder.id===note.folderId)?.name??"文件夹"}</span>}</footer></button>)}</div>
    </aside>
    <main className="nt-note-stage">
      {openedIds.length>0&&<div className="nt-tabs">{openedIds.map(id=>{const note=libraryNotes.find(item=>item.id===id)||(selected?.id===id?selected:null);return <div key={id} className={selected?.id===id?"active":""}><button onClick={()=>void open(id)}>{note?titleOf(note):"笔记"}</button><button aria-label="关闭标签" onClick={()=>void closeTab(id)}><X/></button></div>})}</div>}
      {selected?<NoteEditor key={selected.id} note={selected} folders={folders} tags={tags} trashMode={scope==="trash"} onOpenNote={open} registerSave={save=>{saveBeforeSwitch.current=save;return()=>{if(saveBeforeSwitch.current===save)saveBeforeSwitch.current=null}}} onSaved={saved=>{setSelected(saved);selectedIdRef.current=saved.id;setNotes(current=>current.map(item=>item.id===saved.id?{...item,...saved}:item));setLibraryNotes(current=>current.map(item=>item.id===saved.id?{...item,...saved}:item))}} onListChanged={refresh}/>:<section className="nt-editor nt-empty-editor"><div><NotebookPen/><h2>选择一篇笔记</h2><p>内容会自动保存到本机 SQLite，并通过原生同步引擎同步。</p><button className="hx-btn primary" onClick={()=>void create("document")}><Plus/>新建笔记</button></div></section>}
    </main>
  </div>
  {graphOpen&&<div className="nt-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setGraphOpen(false)}}><section className="nt-graph"><header><div><Network/><strong>Notes Graph</strong><small>Wiki Link 关系图 · 最多 80 篇</small></div><button onClick={()=>setGraphOpen(false)}><X/></button></header>{graphLoading?<div className="nt-list-empty"><Network/><strong>正在读取双链索引…</strong></div>:graphPoints.length?<svg viewBox="0 0 760 440" role="img" aria-label="笔记知识图谱"><g className="edges">{graphEdges.map((edge,index)=><line key={index} x1={edge.source.x} y1={edge.source.y} x2={edge.target.x} y2={edge.target.y}/>)}</g>{graphPoints.map(point=><g key={point.id} className="node" onClick={()=>{setGraphOpen(false);void open(point.id)}}><circle cx={point.x} cy={point.y} r={point.favorite?8:6}/><text x={point.x} y={point.y+18} textAnchor="middle">{point.title.length>18?`${point.title.slice(0,17)}…`:point.title}</text></g>)}</svg>:<div className="nt-list-empty"><Network/><strong>知识图谱为空</strong><p>在正文中使用 [[Wiki Link]] 后会形成关系图。</p></div>}</section></div>}
  {commandOpen&&<div className="nt-command-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setCommandOpen(false)}}><section className="nt-command"><header><Search/><strong>快速命令</strong><kbd>Esc</kbd><button onClick={()=>setCommandOpen(false)}><X/></button></header><div>
    <button onClick={()=>{setCommandOpen(false);void create("document")}}><Plus/><span><strong>新建笔记</strong><small>Ctrl + N</small></span></button>
    <button onClick={()=>{setCommandOpen(false);void openDailyNote()}}><CalendarDays/><span><strong>打开今日日记</strong><small>Daily</small></span></button>
    <button onClick={()=>{setCommandOpen(false);void create("quick")}}><FileText/><span><strong>新建快速记录</strong><small>Ctrl + Shift + N</small></span></button>
    <button onClick={()=>{setCommandOpen(false);searchRef.current?.focus()}}><Search/><span><strong>搜索笔记</strong><small>Ctrl + Shift + F</small></span></button>
    <button onClick={()=>{setCommandOpen(false);void showGraph()}}><Network/><span><strong>打开知识图谱</strong><small>Graph</small></span></button>
    <button onClick={()=>{setCommandOpen(false);void importMarkdown()}}><FileUp/><span><strong>导入 Markdown</strong><small>桌面文件</small></span></button>
    {selected&&<><button onClick={()=>void toggleSelected("isFavorite")}><Star/><span><strong>{selected.isFavorite?"取消收藏":"收藏当前笔记"}</strong></span></button><button onClick={()=>void toggleSelected("isPinned")}><Pin/><span><strong>{selected.isPinned?"取消置顶":"置顶当前笔记"}</strong></span></button><button onClick={()=>void exportSelected()}><Download/><span><strong>导出当前笔记</strong><small>Markdown</small></span></button></>}
    {notes.slice(0,8).map(note=><button key={note.id} onClick={()=>{setCommandOpen(false);void open(note.id)}}><File/><span><strong>打开 · {titleOf(note)}</strong><small>{formatTime(note.updatedAt)}</small></span></button>)}
  </div></section></div>}</>;
}

export function DashboardNotes({openNotes}:{openNotes:(id?:string)=>void}){
  const [text,setText]=useState("");const [recent,setRecent]=useState<Note[]>([]);const [saving,setSaving]=useState(false);
  const reload=useCallback(()=>noteApi.list({scope:"all",sort:"updated_desc",limit:5}).then(setRecent).catch(()=>undefined),[]);
  useEffect(()=>{void reload()},[reload]);
  const submit=async()=>{const value=text.trim();if(!value||saving)return;setSaving(true);try{await noteApi.create({title:null,noteType:"quick",folderId:null,contentJson:markdownContentJson(value,emptyJson,{status:"",source:"lifetrace",aliases:[]}),contentHtml:"",contentText:plainTextFromMarkdown(value),contentMarkdown:value,summary:cleanSummary(plainTextFromMarkdown(value)),isPinned:false,isFavorite:false,isArchived:false,tagIds:[],relations:[]});setText("");await reload();notify("快速记录已保存")}finally{setSaving(false)}};
  return <article className="hx-panel nt-dashboard-widget"><header><div><span>快速记录</span><h2>记录此刻的想法</h2></div><button onClick={()=>openNotes()}>打开笔记 <ChevronRight/></button></header><div className="nt-quick"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.ctrlKey&&e.key==="Enter"){e.preventDefault();void submit()}}} placeholder="记录此刻的想法……"/><footer><small>Ctrl + Enter 提交</small><button disabled={!text.trim()||saving} onClick={()=>void submit()}>{saving?"保存中":"保存记录"}</button></footer></div>{recent.length>0&&<div className="nt-recent"><strong>最近笔记</strong>{recent.map(note=><button key={note.id} onClick={()=>openNotes(note.id)}><span>{titleOf(note)}</span><small>{formatTime(note.updatedAt)}</small></button>)}</div>}</article>;
}

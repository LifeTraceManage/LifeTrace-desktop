import { invoke } from "@tauri-apps/api/core";
import type { Note, NoteFolder, NoteRevision, NoteTag, NoteType } from "@/src/types";

type ListOptions = { q?:string;scope?:string;folderId?:string;tagId?:string;noteType?:NoteType;sort?:string;limit?:number };
type NoteInput = Pick<Note,"title"|"noteType"|"folderId"|"contentJson"|"contentHtml"|"contentText"|"contentMarkdown"|"summary"|"isPinned"|"isFavorite"|"isArchived"> & {
  id?:string; tagIds:string[]; relations: Note["relations"]; createRevision?:boolean;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function httpRequest<T>(url:string, init?:RequestInit):Promise<T>{
  const response=await fetch(url,init);
  const payload=await response.json() as T & {error?:string};
  if(!response.ok)throw new Error(payload.error||"笔记服务暂时不可用");
  return payload;
}

async function query<T>(request:Record<string,unknown>, fallbackUrl:string):Promise<T>{
  if(isTauriRuntime()) return invoke<T>("notes_query",{request});
  return httpRequest<T>(fallbackUrl);
}

async function mutate<T>(body:Record<string,unknown>):Promise<T>{
  if(isTauriRuntime()) return invoke<T>("notes_mutate",{request:body});
  return httpRequest<T>("/api/notes",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body),
  });
}

export const noteApi={
  list:(options:ListOptions={})=>{
    const queryString=new URLSearchParams();
    Object.entries(options).forEach(([key,value])=>{if(value!==undefined&&value!=="")queryString.set(key,String(value))});
    return query<Note[]>({action:"list",...options},`/api/notes?${queryString}`);
  },
  get:(id:string)=>query<Note>({action:"get",id},`/api/notes?action=get&id=${encodeURIComponent(id)}`),
  meta:()=>query<{folders:NoteFolder[];tags:(NoteTag&{usageCount?:number})[]}>({action:"meta"},"/api/notes?action=meta"),
  revisions:(id:string)=>query<NoteRevision[]>({action:"revisions",id},`/api/notes?action=revisions&id=${encodeURIComponent(id)}`),
  backup:()=>query<Record<string,unknown>>({action:"backup"},"/api/notes?action=backup"),
  create:(note:NoteInput)=>mutate<Note>({action:"create",note}),
  update:(note:NoteInput&{id:string})=>mutate<Note>({action:"update",note,createRevision:note.createRevision??false}),
  trash:(id:string)=>mutate<{ok:true}>({action:"trash",id}),
  restore:(id:string)=>mutate<{ok:true}>({action:"restore",id}),
  delete:(id:string)=>mutate<{ok:true}>({action:"delete",id}),
  duplicate:(id:string)=>mutate<Note>({action:"duplicate",id}),
  saveFolder:(folder:Partial<NoteFolder>&Pick<NoteFolder,"name">)=>mutate<{ok:true;id:string}>({action:"folder.save",folder}),
  deleteFolder:(id:string)=>mutate<{ok:true}>({action:"folder.delete",id}),
  saveTag:(tag:Partial<NoteTag>&Pick<NoteTag,"name">)=>mutate<{ok:true;id:string}>({action:"tag.save",tag}),
  deleteTag:(id:string)=>mutate<{ok:true}>({action:"tag.delete",id}),
  restoreRevision:(id:string)=>mutate<Note>({action:"revision.restore",id}),
  recordAttachment:(file:Record<string,unknown>)=>mutate<{ok:true}>({action:"attachment.record",file}),
  deleteAttachment:(id:string)=>mutate<{ok:true}>({action:"attachment.delete",id}),
  restoreBackup:(data:Record<string,unknown>)=>mutate<{ok:true}>({action:"backup.restore",data}),
};

export type NoteInputValue = NoteInput;

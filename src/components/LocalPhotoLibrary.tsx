"use client";
/* eslint-disable @next/next/no-img-element -- native IPC returns the user's local image thumbnail */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, FolderOpen, Images, LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { desktopPhotoLibrary, type LibraryPhoto, type LibrarySnapshot } from "@/src/desktop/photoSyncAdapter";

const PAGE_SIZE = 48;
const THUMB_CONCURRENCY = 4;
const thumbnailCache = new Map<string, string>();
const thumbnailQueue: Array<() => void> = [];
let inFlight = 0;

function scheduleThumbnail(work: () => Promise<string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = () => {
      inFlight++;
      void work().then(resolve, reject).finally(() => {
        inFlight--;
        thumbnailQueue.shift()?.();
      });
    };
    if (inFlight < THUMB_CONCURRENCY) run();
    else thumbnailQueue.push(run);
  });
}

function LocalThumb({ photo }: { photo: LibraryPhoto }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    const key = photo.path + ":" + photo.modifiedAt + ":" + photo.size;
    const cached = thumbnailCache.get(key);
    if (cached) {
      const timer = window.setTimeout(() => setSrc(cached), 0);
      return () => { live = false; window.clearTimeout(timer); };
    }
    void scheduleThumbnail(async () => {
      const image = await desktopPhotoLibrary.image(photo.path, "thumbnail");
      return "data:" + image.mimeType + ";base64," + image.dataBase64;
    }).then((data) => {
      if (thumbnailCache.size >= 300) thumbnailCache.delete(thumbnailCache.keys().next().value ?? "");
      thumbnailCache.set(key, data);
      if (live) setSrc(data);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [photo.path, photo.modifiedAt, photo.size]);

  return <span className="photo-thumb">
    {src ? <img src={src} alt="" loading="lazy" decoding="async" /> :
      <span className="photo-placeholder">
        {failed ? <Images aria-hidden="true" /> : <LoaderCircle className="spin" aria-hidden="true" />}
        <small>{failed ? "无法预览" : "读取中"}</small>
      </span>}
  </span>;
}

const formatSize = (size: number) => size >= 1024 ** 2
  ? (size / 1024 ** 2).toFixed(1) + " MB"
  : Math.max(1, Math.round(size / 1024)) + " KB";
const formatTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString("zh-CN", { hour12: false });

export default function LocalPhotoLibrary() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LibraryPhoto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  const refresh = useCallback(async () => {
    if (!desktopPhotoLibrary.available()) {
      setError("请在 LifeTrace 桌面应用中使用电脑图库。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setSnapshot(await desktopPhotoLibrary.scan());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? (snapshot?.photos ?? []).filter((photo) => photo.name.toLocaleLowerCase().includes(term)) : (snapshot?.photos ?? []);
  }, [snapshot, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const index = selected ? filtered.findIndex((photo) => photo.path === selected.path) : -1;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const load = async () => {
      try {
        const image = await desktopPhotoLibrary.image(selected.path, "preview");
        if (active) setPreview("data:" + image.mimeType + ";base64," + image.dataBase64);
      } catch {
        if (active) setPreviewError(true);
      }
    };
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [selected]);

  const openPhoto = (photo: LibraryPhoto) => {
    setPreview(null);
    setPreviewError(false);
    setSelected(photo);
  };
  const navigatePhoto = (step: number) => {
    const next = filtered[index + step];
    if (next) openPhoto(next);
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft") navigatePhoto(-1);
      if (event.key === "ArrowRight") navigatePhoto(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, index, filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFolder = async () => {
    setFolderBusy(true);
    setError("");
    try {
      const result = await desktopPhotoLibrary.addFolder();
      if (!result.canceled) {
        setPage(1);
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFolderBusy(false);
    }
  };

  const removeFolder = async (path: string) => {
    setFolderBusy(true);
    try {
      await desktopPhotoLibrary.removeFolder(path);
      setPage(1);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setFolderBusy(false);
    }
  };

  return <section className="hx-view photo-sync local-photo-library">
    <header className="photo-sync-hero">
      <div>
        <span className="hx-pill">电脑本地图库</span>
        <h2>在这里查看电脑中的照片</h2>
        <p>自动读取系统“图片”文件夹，也可添加其他文件夹。原文件保留在原位置，不上传、不复制。</p>
      </div>
      <button className="hx-btn primary" type="button" onClick={() => void addFolder()} disabled={folderBusy || busy}>
        <FolderOpen aria-hidden="true" />添加照片文件夹
      </button>
    </header>

    <div className="local-photo-folders" aria-label="当前图库文件夹">
      {(snapshot?.roots ?? []).map((root) =>
        <span className="local-photo-folder" key={root.path} title={root.path}>
          <FolderOpen aria-hidden="true" />
          <span>{root.name}</span>
          {root.removable && <button type="button" title="从图库移除此文件夹（不会删除任何照片）" aria-label={"移除文件夹 " + root.name} disabled={folderBusy} onClick={() => void removeFolder(root.path)}><X aria-hidden="true" /></button>}
        </span>)}
      {!busy && snapshot && snapshot.roots.length === 0 && <span className="local-photo-folder">未找到系统图片文件夹，选择一个文件夹即可接入</span>}
    </div>

    <section className="photo-timeline">
      <header className="photo-section-head">
        <div><span>本地图片</span><h2>{snapshot?.photos.length ?? 0} 张照片</h2></div>
        <div className="photo-section-actions">
          <label className="local-photo-search"><Search aria-hidden="true" /><input aria-label="搜索照片文件名" placeholder="搜索照片" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}/></label>
          <button type="button" className="hx-btn secondary" onClick={() => void refresh()} disabled={busy}><RefreshCw className={busy ? "spin" : ""} aria-hidden="true" />刷新</button>
        </div>
      </header>
      {error && <p className="local-photo-error" role="alert">{error}</p>}
      {snapshot?.truncated && <p className="local-photo-notice">图库照片过多，当前显示最多 25,000 张。可以缩小所选文件夹范围。</p>}
      {busy && !snapshot ? <div className="photo-loading"><LoaderCircle className="spin" /><p>正在读取本机图片文件夹…</p></div> :
        filtered.length ? <>
          <div className="photo-grid">{visible.map((photo) =>
            <button type="button" className="photo-card" key={photo.path} onClick={() => openPhoto(photo)} aria-label={"查看 " + photo.name}>
              <LocalThumb photo={photo} />
              <span className="photo-card-copy"><strong title={photo.name}>{photo.name}</strong><small>{formatTime(photo.modifiedAt)} · {formatSize(photo.size)}</small></span>
            </button>)}</div>
          {pages > 1 && <nav className="photo-pagination" aria-label="本地图库分页">
            <button className="hx-btn secondary" disabled={page === 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
            <span>第 {page} / {pages} 页</span>
            <button className="hx-btn secondary" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>下一页</button>
          </nav>}
        </> : <div className="photo-empty"><Images aria-hidden="true" /><h3>{query ? "没有找到匹配的照片" : "图库里还没有照片"}</h3><p>{query ? "试试其他文件名" : "会自动显示系统“图片”文件夹中的照片，也可点击“添加照片文件夹”选择其他位置。"}</p></div>}
    </section>

    {selected && <div className="hx-overlay photo-preview" role="dialog" aria-modal="true" aria-label={selected.name} onMouseDown={(event) => { if (event.currentTarget === event.target) setSelected(null); }}>
      <article><header><div><strong>{selected.name}</strong><small>{formatTime(selected.modifiedAt)} · {formatSize(selected.size)}</small></div><button type="button" aria-label="关闭预览" onClick={() => setSelected(null)}><X /></button></header>
        <div className="photo-preview-media">{preview ? <img alt={selected.name} src={preview}/> : previewError ? <p>暂不支持预览此照片格式或文件已损坏</p> : <LoaderCircle className="spin" aria-label="正在加载照片" />}</div>
        <footer><button className="local-photo-preview-nav" disabled={index <= 0} onClick={() => navigatePhoto(-1)}><ArrowLeft />上一张</button><span>{index + 1} / {filtered.length} · 本地文件，仅浏览</span><button className="local-photo-preview-nav" disabled={index >= filtered.length - 1} onClick={() => navigatePhoto(1)}>下一张<ArrowRight /></button></footer>
      </article>
    </div>}
  </section>;
}

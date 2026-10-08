"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import {
  footprintApi,
  footprintMediaUrl,
} from "@/src/services/footprintApi";
import type { FootprintPhoto } from "./types";
import {
  PHOTO_PICKER_BATCH_SIZE,
  hasMorePhotoBatches,
  mergePhotoBatches,
} from "./photoPickerPagination";

function photoDisplayTime(photo: FootprintPhoto): string {
  if (photo.modifiedAt != null) {
    // Use the same local-time format as the computer photo library.
    return new Date(photo.modifiedAt * 1000).toLocaleString("zh-CN", { hour12: false });
  }
  // Existing managed photos have no local modification time.
  return (photo.capturedAt || photo.importedAt).replace("T", " ").slice(0, 19);
}

export default function FootprintPhotoPicker({
  selectedIds,
  onChange,
  onClose,
}: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [photos, setPhotos] = useState<FootprintPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState(false);
  const [retry, setRetry] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const nextPagePendingRef = useRef(false);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void footprintApi.photos(page, PHOTO_PICKER_BATCH_SIZE, query)
      .then((value) => {
        if (!active) return;
        setPhotos((existing) => mergePhotoBatches(existing, value.photos, page));
        setTotal(value.total);
        // A short or empty batch means the server has no more rows to return.
        setExhausted(value.photos.length < PHOTO_PICKER_BATCH_SIZE);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "照片加载失败");
      })
      .finally(() => {
        if (!active) return;
        nextPagePendingRef.current = false;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, query, retry]);

  const hasMore = hasMorePhotoBatches(photos.length, total, exhausted);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || loading || error || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || nextPagePendingRef.current) return;
        nextPagePendingRef.current = true;
        setPage((current) => current + 1);
      },
      { root, rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, error, photos.length]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const search = (value: string) => {
    nextPagePendingRef.current = false;
    setQuery(value);
    setPage(1);
    setPhotos([]);
    setTotal(0);
    setExhausted(false);
    setError("");
    setLoading(true);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const retryLoad = () => {
    nextPagePendingRef.current = true;
    setLoading(true);
    setRetry((current) => current + 1);
  };

  return (
    <div
      className="hx-overlay footprint-photo-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="选择足迹照片"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="footprint-photo-picker">
        <header>
          <div>
            <span>照片</span>
            <h2>选择已有照片</h2>
            <p>向下滚动自动加载更多，只建立关联，不复制或移动原文件。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
        </header>
        <div className="footprint-photo-search">
          <Search />
          <input
            value={query}
            onChange={(event) => search(event.target.value)}
            placeholder="搜索文件名"
          />
          <strong>已选 {selected.size}</strong>
        </div>
        <div className="footprint-photo-scroll" ref={scrollRef}>
          <div className="footprint-photo-grid">
            {photos.map((photo) => (
              <button
                type="button"
                className={selected.has(photo.id) ? "selected" : ""}
                key={photo.id}
                onClick={() => toggle(photo.id)}
                aria-pressed={selected.has(photo.id)}
              >
                <img
                  src={footprintMediaUrl(photo.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span>{selected.has(photo.id) ? "✓" : ""}</span>
                <small>{photoDisplayTime(photo)}</small>
              </button>
            ))}
            {loading && photos.length === 0 ? (
              <div className="footprint-photo-loading" role="status">
                <LoaderCircle className="spin" />读取照片…
              </div>
            ) : null}
            {!loading && !error && photos.length === 0 ? (
              <div className="footprint-photo-none"><Camera />没有可选照片</div>
            ) : null}
          </div>
          {error ? (
            <div className="footprint-photo-feed-status" role="alert">
              <span>{error}</span>
              <button type="button" onClick={retryLoad}>重试加载</button>
            </div>
          ) : null}
          {loading && photos.length > 0 ? (
            <div className="footprint-photo-feed-status" role="status">
              <LoaderCircle className="spin" />正在加载更多照片…
            </div>
          ) : null}
          {hasMore && !error ? (
            <div className="footprint-photo-load-trigger" ref={sentinelRef} aria-hidden="true" />
          ) : null}
          {!loading && !error && !hasMore && photos.length > 0 ? (
            <div className="footprint-photo-feed-status" role="status">已加载全部照片</div>
          ) : null}
        </div>
        <footer>
          <span>已显示 {photos.length} / {total} 张 · 已选 {selected.size} 张</span>
          <button type="button" className="primary" onClick={onClose}>完成</button>
        </footer>
      </article>
    </div>
  );
}

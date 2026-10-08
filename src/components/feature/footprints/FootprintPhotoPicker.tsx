"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import {
  footprintApi,
  footprintMediaUrl,
} from "@/src/services/footprintApi";
import type { FootprintPhoto } from "./types";

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
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void footprintApi.photos(page, 48, query)
      .then((value) => {
        if (!active) return;
        setPhotos(value.photos);
        setTotal(value.total);
      })
      .catch(() => {
        if (!active) return;
        setPhotos([]);
        setTotal(0);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, query]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const pages = Math.max(1, Math.ceil(total / 48));
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
            <p>只建立关联，不复制或移动原文件。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
        </header>
        <div className="footprint-photo-search">
          <Search />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="搜索文件名"
          />
          <strong>已选 {selected.size}</strong>
        </div>
        {loading ? (
          <div className="footprint-photo-loading">
            <LoaderCircle className="spin" />读取照片…
          </div>
        ) : (
          <div className="footprint-photo-grid">
            {photos.map((photo) => (
              <button
                type="button"
                className={selected.has(photo.id) ? "selected" : ""}
                key={photo.id}
                onClick={() => toggle(photo.id)}
              >
                <img
                  src={footprintMediaUrl(photo.id)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span>{selected.has(photo.id) ? "✓" : ""}</span>
                <small>
                  {photoDisplayTime(photo)}
                </small>
              </button>
            ))}
            {!photos.length ? (
              <div className="footprint-photo-none"><Camera />没有可选照片</div>
            ) : null}
          </div>
        )}
        <footer>
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
          >
            <ChevronLeft />上一页
          </button>
          <span>{page} / {pages}</span>
          <button
            type="button"
            disabled={page >= pages || loading}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页<ChevronRight />
          </button>
          <button type="button" className="primary" onClick={onClose}>完成</button>
        </footer>
      </article>
    </div>
  );
}

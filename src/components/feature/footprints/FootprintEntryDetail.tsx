"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Camera,
  Edit3,
  Heart,
  MapPin,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  footprintApi,
  footprintMediaUrl,
} from "@/src/services/footprintApi";
import type { FootprintEntryDetail as EntryDetail } from "./types";
import {
  footprintDateLabel,
  footprintDisplayPlace,
} from "./footprintViewModel";
import PhotoSuggestions from "./PhotoSuggestions";
import FootprintLinks from "./FootprintLinks";

export default function FootprintEntryDetail({
  entryId,
  onEdit,
  onDeleted,
  onClose,
  refreshToken = 0,
}: {
  entryId: string;
  onEdit: (detail: EntryDetail) => void;
  onDeleted: () => void;
  onClose: () => void;
  refreshToken?: number;
}) {
  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    void footprintApi.entry(entryId)
      .then(setDetail)
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "读取失败"));
  }, [entryId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const remove = async () => {
    if (
      !detail
      || !window.confirm(`删除“${detail.entry.title}”？照片原文件不会被删除。`)
    ) {
      return;
    }
    await footprintApi.remove(entryId);
    onDeleted();
  };

  if (!detail) {
    return (
      <div className="hx-overlay footprint-detail-overlay">
        <article className="footprint-detail loading">
          {error || "正在读取足迹…"}
        </article>
      </div>
    );
  }
  const { entry, photos } = detail;
  return (
    <div
      className="hx-overlay footprint-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="footprint-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="footprint-detail">
        <header>
          <div>
            <span>
              {entry.favorite ? <Heart className="favorite" /> : <MapPin />}
              {footprintDisplayPlace(entry)}
            </span>
            <h2 id="footprint-detail-title">{entry.title}</h2>
            <p>
              <CalendarDays />{footprintDateLabel(entry)}
              {entry.rating ? <><Star />{entry.rating}/5</> : null}
            </p>
          </div>
          <div className="footprint-detail-actions">
            <button type="button" title="编辑" onClick={() => onEdit(detail)}>
              <Edit3 />
            </button>
            <button
              type="button"
              title="删除"
              className="danger"
              onClick={() => void remove()}
            >
              <Trash2 />
            </button>
            <button type="button" title="关闭" onClick={onClose}><X /></button>
          </div>
        </header>

        {photos.length ? (
          <section className="footprint-photo-wall">
            {photos.map((photo, index) => (
              <a
                href={footprintMediaUrl(photo.id, "original")}
                target="_blank"
                rel="noreferrer"
                key={photo.id}
                className={index === 0 ? "cover" : ""}
              >
                <img
                  src={footprintMediaUrl(photo.id)}
                  alt={photo.originalFileName}
                  loading="lazy"
                />
              </a>
            ))}
          </section>
        ) : (
          <div className="footprint-detail-no-photos">
            <Camera /><span>这次足迹还没有照片</span>
          </div>
        )}

        {entry.description ? (
          <section className="footprint-detail-copy">
            <h3>回忆</h3>
            <p>{entry.description}</p>
          </section>
        ) : null}

        <FootprintLinks entryId={entry.id} />
        <PhotoSuggestions entryId={entry.id} onAttached={load} />
      </article>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Camera,
  LoaderCircle,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  footprintApi,
  footprintMediaUrl,
} from "@/src/services/footprintApi";
import type { FootprintPhotoSuggestion } from "./types";

export default function PhotoSuggestions({
  entryId,
  onAttached,
}: {
  entryId: string;
  onAttached: () => void;
}) {
  const [items, setItems] = useState<FootprintPhotoSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void footprintApi.photoSuggestions(entryId)
      .then((value) => {
        if (active) setItems(value);
      })
      .catch(() => {
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entryId]);

  if (loading) {
    return (
      <div className="footprint-suggestions loading">
        <LoaderCircle className="spin" />正在匹配照片…
      </div>
    );
  }
  if (!items.length) return null;

  const attach = async () => {
    setAdding(true);
    try {
      await footprintApi.attachPhotos(entryId, items.map((item) => item.id));
      setItems([]);
      onAttached();
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="footprint-suggestions">
      <header>
        <div>
          <Sparkles />
          <span>
            <strong>可能属于这次足迹</strong>
            <small>根据拍摄日期与已有 GPS 进行本地匹配</small>
          </span>
        </div>
        <button type="button" disabled={adding} onClick={() => void attach()}>
          {adding ? "添加中…" : `添加全部 ${items.length} 张`}
        </button>
      </header>
      <div>
        {items.slice(0, 8).map((item) => (
          <figure key={item.id}>
            <img
              src={footprintMediaUrl(item.id)}
              alt=""
              loading="lazy"
            />
            <figcaption>
              <Camera />
              {item.capturedAt?.slice(0, 10) || item.importedAt.slice(0, 10)}
              {item.distanceKm != null ? (
                <span><MapPin />{item.distanceKm} km</span>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

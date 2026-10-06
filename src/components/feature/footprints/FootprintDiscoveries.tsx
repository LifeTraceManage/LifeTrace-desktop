"use client";

import { useEffect, useState } from "react";
import {
  CalendarRange,
  Camera,
  LoaderCircle,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  footprintApi,
  footprintMediaUrl,
} from "@/src/services/footprintApi";
import type { FootprintPhotoDiscovery } from "./types";

function dateLabel(discovery: FootprintPhotoDiscovery) {
  return discovery.startedAt === discovery.endedAt
    ? discovery.startedAt
    : `${discovery.startedAt} — ${discovery.endedAt}`;
}

export default function FootprintDiscoveries({
  refreshToken = 0,
  onCreate,
}: {
  refreshToken?: number;
  onCreate: (discovery: FootprintPhotoDiscovery) => void;
}) {
  const [items, setItems] = useState<FootprintPhotoDiscovery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void footprintApi.discoveries()
      .then((value) => {
        if (active) setItems(value);
      })
      .catch((cause) => {
        if (active) {
          setItems([]);
          setError(cause instanceof Error ? cause.message : "照片足迹发现失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshToken]);

  if (loading) {
    return (
      <section className="footprint-discoveries loading">
        <LoaderCircle className="spin" />
        <span>正在从未关联的 GPS 照片中发现足迹…</span>
      </section>
    );
  }
  if (error) {
    return (
      <section className="footprint-discoveries error" role="status">
        <Sparkles />
        <span>{error}</span>
      </section>
    );
  }
  if (!items.length) return null;

  return (
    <section className="footprint-discoveries">
      <header>
        <div>
          <Sparkles />
          <span>
            <strong>发现新的地点</strong>
            <small>
              仅在本地根据拍摄日期和 GPS 聚类；保存前仍由你确认省市。
            </small>
          </span>
        </div>
        <em>{items.length} 组候选</em>
      </header>

      <div className="footprint-discovery-grid">
        {items.map((item) => (
          <article key={item.id}>
            <div className="footprint-discovery-preview">
              {item.samplePhotoIds.slice(0, 4).map((photoId) => (
                <img
                  key={photoId}
                  src={footprintMediaUrl(photoId)}
                  alt=""
                  loading="lazy"
                />
              ))}
            </div>
            <div className="footprint-discovery-copy">
              <strong>{item.photoCount} 张照片</strong>
              <span><CalendarRange />{dateLabel(item)}</span>
              <span>
                <MapPin />
                {item.latitude.toFixed(3)}, {item.longitude.toFixed(3)}
              </span>
              <small>
                <Camera />GPS 仅用于本地聚类，不会发送到第三方地图服务
              </small>
            </div>
            <button type="button" onClick={() => onCreate(item)}>
              生成足迹
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

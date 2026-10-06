"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  Heart,
  MapPin,
  Save,
  X,
} from "lucide-react";
import rawChina from "@/src/assets/maps/china-provinces.json";
import { footprintApi } from "@/src/services/footprintApi";
import type {
  FootprintEntry,
  FootprintEntryInput,
} from "./types";
import FootprintPhotoPicker from "./FootprintPhotoPicker";
import {
  citiesForProvince,
  findCityByName,
} from "./footprintRegion";

type Province = { code: string; name: string };

export type FootprintEditorDraft = {
  title?: string;
  startedAt?: string;
  endedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  provinceCode?: string | null;
  provinceName?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
};

const provinces: Province[] = (
  rawChina as unknown as {
    features: Array<{
      properties: { adcode: number | string; name: string };
    }>;
  }
).features
  .map((feature) => ({
    code: String(feature.properties.adcode),
    name: feature.properties.name,
  }))
  .filter((province) => /^\d{6}$/.test(province.code))
  .sort((left, right) => left.code.localeCompare(right.code));

export default function FootprintEditor({
  entry,
  existingPhotoIds = [],
  preferredProvince,
  draft,
  onSaved,
  onClose,
}: {
  entry?: FootprintEntry | null;
  existingPhotoIds?: string[];
  preferredProvince?: { code: string; name: string } | null;
  draft?: FootprintEditorDraft | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const initialProvince = useMemo(() => {
    if (entry) return { code: entry.provinceCode, name: entry.provinceName };
    if (preferredProvince) return preferredProvince;
    if (draft?.provinceCode && draft?.provinceName) {
      return { code: draft.provinceCode, name: draft.provinceName };
    }
    return null;
  }, [draft?.provinceCode, draft?.provinceName, entry, preferredProvince]);

  const [title, setTitle] = useState(entry?.title ?? draft?.title ?? "");
  const [provinceCode, setProvinceCode] = useState(initialProvince?.code ?? "");
  const [cityName, setCityName] = useState(entry?.cityName ?? draft?.cityName ?? "");
  const [placeName, setPlaceName] = useState(entry?.placeName ?? "");
  const [startedAt, setStartedAt] = useState(
    entry?.startedAt.slice(0, 10)
      ?? draft?.startedAt
      ?? new Date().toISOString().slice(0, 10),
  );
  const [endedAt, setEndedAt] = useState(
    entry?.endedAt?.slice(0, 10) ?? draft?.endedAt ?? "",
  );
  const [description, setDescription] = useState(entry?.description ?? "");
  const [favorite, setFavorite] = useState(entry?.favorite ?? false);
  const [rating, setRating] = useState(entry?.rating ?? 0);
  const [photoIds, setPhotoIds] = useState(existingPhotoIds);
  const cityOptions = useMemo(
    () => provinceCode ? citiesForProvince(provinceCode) : [],
    [provinceCode],
  );
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!title.trim()) {
      setError("请输入足迹标题");
      return;
    }
    if (!provinceCode) {
      setError("请选择省份");
      return;
    }
    if (!cityName.trim()) {
      setError("请输入城市");
      return;
    }
    if (endedAt && endedAt < startedAt) {
      setError("结束日期不能早于开始日期");
      return;
    }
    const province = provinces.find((item) => item.code === provinceCode);
    if (!province) {
      setError("请选择有效省份");
      return;
    }
    const city = findCityByName(province.code, cityName);
    const input: FootprintEntryInput = {
      title: title.trim(),
      description: description.trim() || null,
      startedAt,
      endedAt: endedAt || null,
      visitType: "trip",
      rating: rating || null,
      favorite,
      photoIds,
      location: {
        provinceCode: province.code,
        provinceName: province.name,
        cityCode: entry?.cityCode ?? draft?.cityCode ?? city?.cityCode ?? null,
        cityName: cityName.trim(),
        placeName: placeName.trim() || null,
        countryCode: "CN",
        countryName: "中国",
        source: entry ? "manual" : draft?.latitude != null ? "exif" : "manual",
        latitude: entry?.latitude ?? draft?.latitude ?? null,
        longitude: entry?.longitude ?? draft?.longitude ?? null,
      },
    };
    setSaving(true);
    setError("");
    try {
      if (entry) await footprintApi.update(entry.id, input);
      else await footprintApi.create(input);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="hx-overlay footprint-editor-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="footprint-editor-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) onClose();
        }}
      >
        <article className="footprint-editor">
          <header>
            <div>
              <span>足迹</span>
              <h2 id="footprint-editor-title">
                {entry ? "编辑足迹" : "添加足迹"}
              </h2>
              <p>地点、日期和照片共同组成一次回忆。</p>
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              disabled={saving}
            >
              <X />
            </button>
          </header>
          <div className="footprint-editor-body">
            <label className="wide">
              标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：五一成都"
                autoFocus
              />
            </label>
            <label>
              省份
              <select
                value={provinceCode}
                onChange={(event) => {
                  setProvinceCode(event.target.value);
                  setCityName("");
                }}
              >
                <option value="">请选择省份</option>
                {provinces.map((province) => (
                  <option value={province.code} key={province.code}>
                    {province.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              城市
              <input
                value={cityName}
                onChange={(event) => setCityName(event.target.value)}
                placeholder="成都市"
                list="footprint-city-options"
              />
              <datalist id="footprint-city-options">
                {cityOptions.map((city) => (
                  <option value={city.name} key={city.id} />
                ))}
              </datalist>
            </label>
            <label className="wide">
              具体地点（可选）
              <div className="with-icon">
                <MapPin />
                <input
                  value={placeName}
                  onChange={(event) => setPlaceName(event.target.value)}
                  placeholder="青城山、宽窄巷子…"
                />
              </div>
            </label>
            <label>
              开始日期
              <input
                type="date"
                value={startedAt}
                onChange={(event) => setStartedAt(event.target.value)}
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={endedAt}
                min={startedAt}
                onChange={(event) => setEndedAt(event.target.value)}
              />
            </label>
            <label className="wide">
              描述
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                placeholder="写下这次到访最想记住的事情…"
              />
            </label>
            <div className="footprint-editor-meta wide">
              <label className="favorite">
                <input
                  type="checkbox"
                  checked={favorite}
                  onChange={(event) => setFavorite(event.target.checked)}
                />
                <Heart />收藏这次足迹
              </label>
              <label>
                评分
                <select
                  value={rating}
                  onChange={(event) => setRating(Number(event.target.value))}
                >
                  <option value={0}>未评分</option>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <option key={value} value={value}>{value} / 5</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="footprint-editor-photos wide">
              <div>
                <Camera />
                <span>
                  <strong>照片</strong>
                  <small>已选择 {photoIds.length} 张，只建立引用</small>
                </span>
              </div>
              <button type="button" onClick={() => setPhotoPickerOpen(true)}>
                选择照片
              </button>
            </div>
            {error ? (
              <p className="footprint-editor-error wide" role="alert">{error}</p>
            ) : null}
          </div>
          <footer>
            <button type="button" onClick={onClose} disabled={saving}>取消</button>
            <button
              type="button"
              className="primary"
              onClick={() => void save()}
              disabled={saving}
            >
              <Save />{saving ? "保存中…" : "保存足迹"}
            </button>
          </footer>
        </article>
      </div>
      {photoPickerOpen ? (
        <FootprintPhotoPicker
          selectedIds={photoIds}
          onChange={setPhotoIds}
          onClose={() => setPhotoPickerOpen(false)}
        />
      ) : null}
    </>
  );
}

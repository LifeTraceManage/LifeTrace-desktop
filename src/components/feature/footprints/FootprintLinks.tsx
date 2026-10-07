"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare2,
  Link2,
  LoaderCircle,
  NotebookPen,
  Search,
  Unlink,
} from "lucide-react";
import { footprintApi } from "@/src/services/footprintApi";
import type {
  FootprintEntryLink,
  FootprintLinkCandidate,
} from "./types";

function EntityIcon({ type }: { type: string }) {
  return type === "note.note"
    ? <NotebookPen aria-hidden="true" />
    : <CheckSquare2 aria-hidden="true" />;
}

function typeLabel(type: string): string {
  return type === "note.note" ? "笔记" : "任务";
}

export default function FootprintLinks({ entryId }: { entryId: string }) {
  const [links, setLinks] = useState<FootprintEntryLink[]>([]);
  const [candidates, setCandidates] = useState<FootprintLinkCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState("");
  const [error, setError] = useState("");

  const loadLinks = useCallback(async () => {
    setError("");
    try {
      setLinks(await footprintApi.links(entryId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "关联读取失败");
    }
  }, [entryId]);

  useEffect(() => {
    void loadLinks().finally(() => setLoading(false));
  }, [loadLinks]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void footprintApi.linkCandidates(query)
        .then((values) => { if (active) setCandidates(values); })
        .catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : "关联候选读取失败");
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const linked = useMemo(
    () => new Set(links.map((link) => `${link.entityType}:${link.entityId}`)),
    [links],
  );
  const available = candidates.filter(
    (candidate) => !linked.has(`${candidate.entityType}:${candidate.entityId}`),
  );

  const attach = async (candidate: FootprintLinkCandidate) => {
    const key = `${candidate.entityType}:${candidate.entityId}`;
    setMutating(key);
    setError("");
    try {
      await footprintApi.attachLink(entryId, candidate);
      await loadLinks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加关联失败");
    } finally {
      setMutating("");
    }
  };

  const detach = async (link: FootprintEntryLink) => {
    setMutating(link.id);
    setError("");
    try {
      await footprintApi.detachLink(entryId, link.id);
      setLinks((current) => current.filter((item) => item.id !== link.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "解除关联失败");
    } finally {
      setMutating("");
    }
  };

  return (
    <section className="footprint-links">
      <header>
        <div>
          <Link2 aria-hidden="true" />
          <span>
            <strong>相关内容</strong>
            <small>连接这次足迹涉及的笔记和任务</small>
          </span>
        </div>
        <em>{links.length} 项</em>
      </header>

      {loading ? (
        <div className="footprint-links-loading"><LoaderCircle className="spin" />正在读取关联…</div>
      ) : links.length ? (
        <div className="footprint-linked-items">
          {links.map((link) => (
            <article key={link.id}>
              <EntityIcon type={link.entityType} />
              <span><strong>{link.label}</strong><small>{typeLabel(link.entityType)}</small></span>
              <button
                type="button"
                title="解除关联"
                aria-label={`解除 ${link.label} 的关联`}
                disabled={Boolean(mutating)}
                onClick={() => void detach(link)}
              >
                {mutating === link.id ? <LoaderCircle className="spin" /> : <Unlink />}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="footprint-links-empty">还没有关联内容。</p>
      )}

      <label className="footprint-link-search">
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索笔记或任务"
        />
      </label>

      <div className="footprint-link-candidates">
        {available.slice(0, 8).map((candidate) => {
          const key = `${candidate.entityType}:${candidate.entityId}`;
          return (
            <button
              type="button"
              key={key}
              disabled={Boolean(mutating)}
              onClick={() => void attach(candidate)}
            >
              <EntityIcon type={candidate.entityType} />
              <span>
                <strong>{candidate.label}</strong>
                <small>{candidate.detail}</small>
              </span>
              {mutating === key ? <LoaderCircle className="spin" /> : <Link2 />}
            </button>
          );
        })}
        {!available.length && query.trim() ? <p>没有找到可关联的笔记或任务。</p> : null}
      </div>
      {error ? <p className="footprint-links-error" role="alert">{error}</p> : null}
    </section>
  );
}

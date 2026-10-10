import { FormEvent, useState } from "react";
import { Search, LoaderCircle, ArrowRight, Database } from "lucide-react";
import { analyticsApi } from "@/src/services/analyticsApi";
import type { SearchHit } from "@/src/types/analytics";
import { EmptyState } from "@/src/components/common";

export default function DesktopSearchModule({
  onOpenEntity,
}: {
  onOpenEntity: (entityType: string, entityId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const run = async (event?: FormEvent) => {
    event?.preventDefault();
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      setItems(await analyticsApi.search({ q, limit: 80 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "搜索失败");
    } finally {
      setLoading(false);
    }
  };

  return <div className="hx-view">
    <article className="hx-panel">
      <header className="hx-panel-head">
        <div><span className="hx-kicker">本地优先</span><h2>全局搜索</h2></div>
        <small><Database/> SQLite 索引</small>
      </header>
      <div className="hx-panel-body">
        <form className="lt-desktop-search-form" onSubmit={run}>
          <Search/>
          <input autoFocus value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="搜索笔记、坚持、训练和执行记录…"/>
          <button className="hx-btn primary" disabled={loading || !query.trim()}>{loading ? <LoaderCircle className="spin"/> : <Search/>}搜索</button>
        </form>
        {error ? <div className="lt-desk-error" role="alert">{error}</div> : null}
      </div>
    </article>
    <article className="hx-panel">
      <header className="hx-panel-head"><div><span className="hx-kicker">结果</span><h2>{searched ? "找到 " + items.length + " 条" : "等待搜索"}</h2></div></header>
      <div className="hx-panel-body lt-desktop-search-results">
        {items.map((item)=><button key={item.id} type="button" onClick={()=>onOpenEntity(item.entityType,item.entityId)}>
          <span><strong>{item.title}</strong><small>{item.domain} · {item.snippet}</small></span><ArrowRight/>
        </button>)}
        {searched && !loading && !items.length ? <EmptyState title="没有匹配结果" hint="换一个关键词试试。"/> : null}
        {!searched ? <EmptyState title="搜索你的本地 LifeTrace 数据" hint="搜索由 Desktop 本地索引完成，不依赖 Web frontend。"/> : null}
      </div>
    </article>
  </div>;
}

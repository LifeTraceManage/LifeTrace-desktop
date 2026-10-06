import { Camera, Heart, MapPin } from "lucide-react";
import type { FootprintEntry } from "./types";
import {
  footprintDateLabel,
  footprintDisplayPlace,
  groupFootprintsByYear,
} from "./footprintViewModel";

export default function FootprintTimelineView({
  entries,
  onOpen,
}: {
  entries: FootprintEntry[];
  onOpen: (entry: FootprintEntry) => void;
}) {
  const groups = groupFootprintsByYear(entries);
  if (!groups.length) {
    return (
      <div className="footprint-empty">
        <MapPin />
        <h2>还没有足迹</h2>
        <p>新增一次到访后，会按年份出现在这里。</p>
      </div>
    );
  }
  return (
    <section className="footprint-timeline" aria-label="足迹时间线">
      {groups.map((group) => (
        <section key={group.year}>
          <header>
            <strong>{group.year}</strong>
            <span>{group.entries.length} 次记录</span>
          </header>
          <div>
            {group.entries.map((entry) => (
              <button type="button" key={entry.id} onClick={() => onOpen(entry)}>
                <time>{entry.startedAt.slice(5, 10).replace("-", ".")}</time>
                <span className="footprint-timeline-dot" />
                <div>
                  <strong>
                    {entry.title}
                    {entry.favorite ? <Heart className="favorite" /> : null}
                  </strong>
                  <small>{footprintDisplayPlace(entry)}</small>
                  <em>{footprintDateLabel(entry)}</em>
                </div>
                <span className="footprint-timeline-photo">
                  <Camera />{entry.photoCount}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

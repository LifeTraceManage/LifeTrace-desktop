import { Camera, Heart, MapPinned, Navigation } from "lucide-react";
import type { FootprintSummary as Summary } from "./types";

export default function FootprintSummary({ value }: { value: Summary }) {
  const cards = [
    { label: "省份", value: value.provinceCount, icon: MapPinned },
    { label: "城市", value: value.cityCount, icon: Navigation },
    { label: "足迹", value: value.entryCount, icon: Heart },
    { label: "照片", value: value.photoCount, icon: Camera },
  ];
  return (
    <section className="footprint-summary" aria-label="足迹统计">
      {cards.map(({ label, value: count, icon: Icon }) => (
        <article key={label}>
          <Icon aria-hidden="true" />
          <span>{label}</span>
          <strong>{count}</strong>
        </article>
      ))}
    </section>
  );
}

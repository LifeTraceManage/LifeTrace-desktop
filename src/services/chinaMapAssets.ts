import chinaProvincesUrl from "@/src/assets/maps/china-provinces.json?url";

// Keep the large GeoJSON as a bundled, local static asset instead of JavaScript.
// Cache the promise so React Suspense can safely reuse the same load on rerenders.
let chinaProvincesPromise: Promise<unknown> | null = null;

export function loadChinaProvinces(): Promise<unknown> {
  chinaProvincesPromise ??= fetch(chinaProvincesUrl).then((response) => {
    if (!response.ok) throw new Error("无法读取本地中国地图数据");
    return response.json() as Promise<unknown>;
  });
  return chinaProvincesPromise;
}

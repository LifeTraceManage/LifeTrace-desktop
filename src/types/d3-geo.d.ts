declare module "d3-geo" {
  export function geoArea(object: unknown): number;
  export function geoMercator(): {
    fitExtent(extent: [[number, number], [number, number]], object: unknown): unknown;
  };
  export function geoPath(projection?: unknown): (object: unknown) => string | null;
}

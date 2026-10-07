declare module "d3-geo" {
  export type GeoProjection = {
    (point: [number, number]): [number, number] | null;
    fitExtent(
      extent: [[number, number], [number, number]],
      object: unknown,
    ): GeoProjection;
  };

  export function geoArea(object: unknown): number;
  export function geoMercator(): GeoProjection;
  export function geoPath(projection?: unknown): (object: unknown) => string | null;
}

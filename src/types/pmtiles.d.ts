declare module "pmtiles" {
  export enum TileType {
    Unknown = 0,
    Mvt = 1,
    Png = 2,
    Jpeg = 3,
    Webp = 4,
    Avif = 5,
    Mlt = 6,
  }

  export interface Header {
    tileType: TileType;
    minZoom: number;
    maxZoom: number;
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
    centerZoom: number;
    centerLon: number;
    centerLat: number;
  }

  export class PMTiles {
    constructor(source: string);
    getHeader(): Promise<Header>;
    getMetadata(): Promise<Record<string, unknown>>;
  }

  export class Protocol {
    constructor(options?: { metadata?: boolean });
    tile: (...args: any[]) => any;
    add(archive: PMTiles): void;
  }
}

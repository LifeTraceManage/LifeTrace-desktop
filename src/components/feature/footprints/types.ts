export type FootprintMode = "map" | "timeline";

export type FootprintSummary = {
  provinceCount: number;
  cityCount: number;
  entryCount: number;
  photoCount: number;
  favoriteCount: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
};

export type ProvinceFootprintSummary = {
  provinceCode: string;
  provinceName: string;
  cityCount: number;
  visitCount: number;
  photoCount: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
};

export type CityFootprintSummary = {
  cityCode: string | null;
  cityName: string;
  visitCount: number;
  photoCount: number;
  firstVisitedAt: string | null;
  lastVisitedAt: string | null;
};

export type FootprintEntry = {
  id: string;
  locationId: string;
  title: string;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  visitType: string;
  rating: number | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  countryCode: string;
  countryName: string;
  provinceCode: string;
  provinceName: string;
  cityCode: string | null;
  cityName: string | null;
  districtCode: string | null;
  districtName: string | null;
  placeName: string | null;
  latitude: number | null;
  longitude: number | null;
  photoCount: number;
  coverPhotoId: string | null;
};

export type FootprintPhoto = {
  id: string;
  originalFileName: string;
  mediaType: string;
  capturedAt: string | null;
  importedAt: string;
  latitude: number | null;
  longitude: number | null;
};

export type FootprintPhotoSuggestion = FootprintPhoto & {
  score: number;
  distanceKm: number | null;
  reason: string;
};

export type FootprintEntryDetail = {
  entry: FootprintEntry;
  photos: FootprintPhoto[];
};

export type ProvinceFootprintDetail = {
  cities: CityFootprintSummary[];
  entries: FootprintEntry[];
};

export type FootprintLocationInput = {
  id?: string;
  countryCode?: string;
  countryName?: string;
  provinceCode: string;
  provinceName: string;
  cityCode?: string | null;
  cityName?: string | null;
  districtCode?: string | null;
  districtName?: string | null;
  placeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
};

export type FootprintEntryInput = {
  locationId?: string;
  location?: FootprintLocationInput;
  title: string;
  description?: string | null;
  startedAt: string;
  endedAt?: string | null;
  visitType?: string;
  rating?: number | null;
  favorite?: boolean;
  photoIds?: string[];
};

export type FootprintPhotoPage = {
  photos: FootprintPhoto[];
  total: number;
  page: number;
  pageSize: number;
};

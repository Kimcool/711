
export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface StoreInfo {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  uri?: string;
  title?: string;
}

export interface AppState {
  loading: boolean;
  error: string | null;
  location: Coordinates | null;
  stores: StoreInfo[];
  rawResponse: string;
}

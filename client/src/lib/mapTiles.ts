import L from 'leaflet';

const CARTO_API_KEY = (import.meta.env.VITE_CARTO_API_KEY as string | undefined)?.trim() || '';

/**
 * Returns the authenticated CARTO Voyager raster tile layer when VITE_CARTO_API_KEY is configured,
 * or falls back cleanly to standard OpenStreetMap tiles so map tiles never display an API-key watermark.
 */
export function createBaseTileLayer(): L.TileLayer {
  if (CARTO_API_KEY) {
    return L.tileLayer(
      `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_API_KEY)}`,
      {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxNativeZoom: 18,
        maxZoom: 20,
      }
    );
  }

  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  });
}

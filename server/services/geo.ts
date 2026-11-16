export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RetailerCoverageInput {
  lat: number;
  lng: number;
  max_delivery_radius_km: number;
  coverage_areas_json: string;
  city: string;
  state: string;
  base_delivery_fee_kobo: number;
  per_km_delivery_fee_kobo: number;
  estimated_prep_mins: number;
}

export interface CoverageCheckResult {
  canDeliver: boolean;
  distanceKm: number;
  reason: string;
  matchedArea?: string;
  deliveryFeeKobo: number;
  estimatedDeliveryMins: number;
}

export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c * 100) / 100;
}

export function parseCoverageAreas(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
    return [];
  } catch {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

/**
 * Verifies whether a retailer can deliver to a target customer coordinate + optional neighbourhood/city.
 * Clearly separates a retailer's physical depot coordinates from its administrator-defined delivery coverage.
 */
export function checkRetailerCoverage(
  retailer: RetailerCoverageInput,
  target: { lat: number; lng: number; neighbourhood?: string; city?: string; state?: string }
): CoverageCheckResult {
  const distanceKm = haversineDistanceKm(
    { lat: retailer.lat, lng: retailer.lng },
    { lat: target.lat, lng: target.lng }
  );
  const areas = parseCoverageAreas(retailer.coverage_areas_json);
  const normAreas = areas.map((a) => a.toLowerCase());
  const targetNeighbourhood = (target.neighbourhood || '').trim().toLowerCase();
  const targetCity = (target.city || '').trim().toLowerCase();

  let matchedArea: string | undefined;
  if (targetNeighbourhood) {
    const idx = normAreas.findIndex(
      (a) => a === targetNeighbourhood || a.includes(targetNeighbourhood) || targetNeighbourhood.includes(a)
    );
    if (idx >= 0) matchedArea = areas[idx];
  }
  if (!matchedArea && targetCity) {
    const idx = normAreas.findIndex((a) => a === targetCity);
    if (idx >= 0) matchedArea = areas[idx];
  }

  const withinRadius = distanceKm <= retailer.max_delivery_radius_km;
  // Allow area match up to 1.4x max radius to accommodate irregular neighbourhood boundaries
  const canDeliver = withinRadius || (Boolean(matchedArea) && distanceKm <= retailer.max_delivery_radius_km * 1.4);

  const deliveryFeeKobo =
    Math.round(
      (retailer.base_delivery_fee_kobo + Math.ceil(distanceKm) * retailer.per_km_delivery_fee_kobo) / 5000
    ) * 5000;

  // Estimate urban Nigerian road travel time (~20 km/h average urban speed + retailer prep)
  const travelMins = Math.max(10, Math.round((distanceKm / 18) * 60));
  const estimatedDeliveryMins = Math.min(95, (retailer.estimated_prep_mins || 15) + travelMins);

  let reason: string;
  if (canDeliver) {
    reason = matchedArea
      ? `Covers ${matchedArea} (${distanceKm.toFixed(1)} km from depot)`
      : `Within ${retailer.max_delivery_radius_km} km delivery radius (${distanceKm.toFixed(1)} km away)`;
  } else {
    reason = `Outside delivery coverage (${distanceKm.toFixed(1)} km away; max coverage radius is ${retailer.max_delivery_radius_km} km)`;
  }

  return {
    canDeliver,
    distanceKm,
    reason,
    matchedArea,
    deliveryFeeKobo,
    estimatedDeliveryMins,
  };
}

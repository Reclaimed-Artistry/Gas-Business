import type { DeliveryLocation } from '../types';

export const NIGERIAN_PRESET_LOCATIONS: DeliveryLocation[] = [
  {
    label: 'Ewet Housing Estate, Uyo',
    addressLine: 'Line F, Plot 12, Ewet Housing Estate',
    neighbourhood: 'Ewet Housing',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0198,
    lng: 7.9462,
  },
  {
    label: 'Shelter Afrique Estate, Uyo',
    addressLine: 'Plot 14, Lane C, Shelter Afrique Estate',
    neighbourhood: 'Shelter Afrique',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 4.9965,
    lng: 7.9592,
  },
  {
    label: 'Oron Road / Ibom Plaza, Uyo',
    addressLine: '74 Oron Road, near Ibom Plaza',
    neighbourhood: 'Oron Road',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0282,
    lng: 7.9348,
  },
  {
    label: 'Udo Udoma Avenue, Uyo',
    addressLine: 'Suite 8, Udo Udoma Banking Layout',
    neighbourhood: 'Udo Udoma',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0068,
    lng: 7.9488,
  },
  {
    label: 'Ikot Ekpene Road / UNIUYO, Uyo',
    addressLine: '21 Ikot Ekpene Road, near UNIUYO Town Campus',
    neighbourhood: 'Ikot Ekpene Road',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0492,
    lng: 7.9082,
  },
  {
    label: 'Abak Road, Uyo',
    addressLine: '22 Abak Road, near Federal Secretariat',
    neighbourhood: 'Abak Road',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0322,
    lng: 7.8935,
  },
  {
    label: 'Nwaniba Road, Uyo',
    addressLine: '45 Nwaniba Road, Use Offot',
    neighbourhood: 'Nwaniba',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0398,
    lng: 7.9575,
  },
  {
    label: 'Osongama Estate, Uyo',
    addressLine: 'Road 6, Osongama Housing Estate',
    neighbourhood: 'Osongama',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0124,
    lng: 7.9212,
  },
  {
    label: 'Aka Etinan / Itam Junction, Uyo',
    addressLine: '16 Aka Road, near Aka Junction',
    neighbourhood: 'Aka Road',
    city: 'Uyo',
    state: 'Akwa Ibom',
    lat: 5.0165,
    lng: 7.9054,
  },
  {
    label: 'Ikot Ekpene Town (Out-of-Coverage Test)',
    addressLine: '18 Aba Road, Ikot Ekpene',
    neighbourhood: 'Ikot Ekpene',
    city: 'Ikot Ekpene',
    state: 'Akwa Ibom',
    lat: 5.1819,
    lng: 7.7148,
  },
  {
    label: 'Eket Town (Out-of-Coverage Test)',
    addressLine: '12 Eket-Oron Road, Eket',
    neighbourhood: 'Eket',
    city: 'Eket',
    state: 'Akwa Ibom',
    lat: 4.6423,
    lng: 7.9244,
  },
];

export function matchNearestPreset(lat: number, lng: number): DeliveryLocation {
  let best = NIGERIAN_PRESET_LOCATIONS[0];
  let bestDist = Infinity;
  for (const loc of NIGERIAN_PRESET_LOCATIONS) {
    const d = Math.hypot(loc.lat - lat, loc.lng - lng);
    if (d < bestDist) {
      bestDist = d;
      best = loc;
    }
  }
  // A nearby preset is only an approximate area, not reverse geocoding.
  // Do not label distant locations as Uyo (or any other preset city).
  if (bestDist > 0.1) {
    return {
      label: 'Selected location (outside mapped areas)',
      addressLine: `Map pin (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
      neighbourhood: 'Unknown area', city: 'Unknown city', state: 'Unknown state', lat, lng,
    };
  }
  return {
    ...best,
    lat,
    lng,
    label: `Pinned near ${best.neighbourhood}, ${best.city}`,
    addressLine: `Map Pin (${lat.toFixed(6)}, ${lng.toFixed(6)}) near ${best.neighbourhood}`,
  };
}

import type { DeliveryLocation } from '../types';

export const NIGERIAN_PRESET_LOCATIONS: DeliveryLocation[] = [
  {
    label: 'Lekki Phase 1, Lagos',
    addressLine: '14B Admiralty Road, off Admiralty Way',
    neighbourhood: 'Lekki Phase 1',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4432,
    lng: 3.4658,
  },
  {
    label: 'Victoria Island, Lagos',
    addressLine: '28 Saka Tinubu Street, Victoria Island',
    neighbourhood: 'Victoria Island',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4272,
    lng: 3.4254,
  },
  {
    label: 'Ikoyi, Lagos',
    addressLine: '15 Bourdillon Road, Old Ikoyi',
    neighbourhood: 'Ikoyi',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4516,
    lng: 3.4384,
  },
  {
    label: 'Ikeja GRA, Lagos',
    addressLine: '7 Joel Ogunnaike Street, Ikeja GRA',
    neighbourhood: 'Ikeja GRA',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.5833,
    lng: 3.3569,
  },
  {
    label: 'Yaba, Lagos',
    addressLine: '112 Commercial Avenue, Sabo Yaba',
    neighbourhood: 'Yaba',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.5082,
    lng: 3.3753,
  },
  {
    label: 'Surulere, Lagos',
    addressLine: '42 Bode Thomas Street, Surulere',
    neighbourhood: 'Surulere',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4951,
    lng: 3.3588,
  },
  {
    label: 'Gbagada Phase 2, Lagos',
    addressLine: '21 Olusegun Aina Street, Gbagada',
    neighbourhood: 'Gbagada',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.5542,
    lng: 3.3895,
  },
  {
    label: 'Ajah / VGC, Lagos',
    addressLine: 'Road 14, Victoria Garden City (VGC), Ajah',
    neighbourhood: 'VGC',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.4631,
    lng: 3.5567,
  },
  {
    label: 'Wuse II, Abuja',
    addressLine: 'Plot 240 Adetokunbo Ademola Crescent, Wuse II',
    neighbourhood: 'Wuse II',
    city: 'Abuja',
    state: 'FCT Abuja',
    lat: 9.0778,
    lng: 7.4765,
  },
  {
    label: 'Maitama, Abuja',
    addressLine: '18 Aguiyi Ironsi Street, Maitama',
    neighbourhood: 'Maitama',
    city: 'Abuja',
    state: 'FCT Abuja',
    lat: 9.0882,
    lng: 7.4934,
  },
  {
    label: 'Epe Outskirts, Lagos (Coverage Test)',
    addressLine: 'Ita-Marun Road, Epe',
    neighbourhood: 'Epe',
    city: 'Lagos',
    state: 'Lagos',
    lat: 6.5841,
    lng: 3.9834,
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
  return {
    ...best,
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    label: `Pinned near ${best.neighbourhood}, ${best.city}`,
    addressLine: `Map Pin (${lat.toFixed(4)}, ${lng.toFixed(4)}) near ${best.neighbourhood}`,
  };
}

import React, { createContext, useContext, useState } from 'react';
import { NIGERIAN_PRESET_LOCATIONS, matchNearestPreset } from '../lib/locations';
import type { DeliveryLocation } from '../types';

const STORAGE_KEY = 'blueflame_uyo_delivery_location_v2';

interface LocationContextValue {
  location: DeliveryLocation;
  setLocation: (loc: DeliveryLocation) => void;
  setCoordinates: (lat: number, lng: number) => void;
  detectGpsLocation: () => Promise<{ ok: boolean; message: string }>;
  locating: boolean;
}

const LocationContext = createContext<LocationContextValue | null>(null);

function loadInitialLocation(): DeliveryLocation {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DeliveryLocation;
      if (parsed && typeof parsed.lat === 'number' && typeof parsed.lng === 'number') {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return NIGERIAN_PRESET_LOCATIONS[0];
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<DeliveryLocation>(loadInitialLocation);
  const [locating, setLocating] = useState(false);

  const setLocation = (loc: DeliveryLocation) => {
    setLocationState(loc);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    } catch {
      // ignore
    }
  };

  const setCoordinates = (lat: number, lng: number) => {
    const matched = matchNearestPreset(lat, lng);
    setLocation(matched);
  };

  const detectGpsLocation = async (): Promise<{ ok: boolean; message: string }> => {
    if (!('geolocation' in navigator)) {
      return { ok: false, message: 'GPS geolocation is not supported by this browser. Please choose a Uyo neighbourhood manually.' };
    }
    setLocating(true);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          const matched = matchNearestPreset(latitude, longitude);
          setLocation({
            ...matched,
            label: `GPS Location (${matched.neighbourhood})`,
            addressLine: `GPS Detected (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`,
          });
          setLocating(false);
          resolve({ ok: true, message: 'GPS location updated.' });
        },
        () => {
          setLocating(false);
          resolve({
            ok: false,
            message: 'Location permission denied or unavailable. Select a Uyo neighbourhood or pin directly on the map.',
          });
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  };

  return (
    <LocationContext.Provider value={{ location, setLocation, setCoordinates, detectGpsLocation, locating }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocationContext() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocationContext must be used inside LocationProvider');
  return ctx;
}

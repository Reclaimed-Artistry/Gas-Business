import React, { createContext, useContext, useRef, useState } from 'react';
import { NIGERIAN_PRESET_LOCATIONS, matchNearestPreset } from '../lib/locations';
import type { DeliveryLocation } from '../types';
import { getDeviceLocation, locationErrorMessage } from '../lib/deviceLocation';

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
  const selectionVersion = useRef(0);
  const locatingRef = useRef(false);

  const setLocation = (loc: DeliveryLocation) => {
    selectionVersion.current += 1;
    setLocationState(loc);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
    } catch {
      // ignore
    }
  };

  const setCoordinates = (lat: number, lng: number) => {
    const matched = matchNearestPreset(lat, lng);
    setLocation({ ...matched, source: 'map' });
  };

  const detectGpsLocation = async (): Promise<{ ok: boolean; message: string }> => {
    if (!window.isSecureContext) {
      return { ok: false, message: 'Device location requires a secure HTTPS connection.' };
    }
    if (!navigator.geolocation) {
      return { ok: false, message: 'This browser does not support device location. Select a point on the map instead.' };
    }
    if (locatingRef.current) return { ok: false, message: 'A location request is already in progress.' };
    locatingRef.current = true;
    setLocating(true);
    const version = selectionVersion.current;
    try {
      const pos = await getDeviceLocation(navigator.geolocation);
      if (version !== selectionVersion.current) return { ok: false, message: 'Location selection changed; GPS result was not applied.' };
      const { latitude, longitude, accuracy } = pos.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0) {
        throw new Error('Invalid device location');
      }
      const matched = matchNearestPreset(latitude, longitude);
      const distance = Math.max(1, Math.ceil(accuracy));
      setLocation({ ...matched, source: 'gps', accuracyMeters: accuracy, capturedAt: pos.timestamp,
        label: 'Device location',
        addressLine: `Device location (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`,
      });
      return { ok: true, message: `Device location updated (estimated accuracy ±${distance} m). Check the pin and enter your street address.` };
    } catch (error) {
      return { ok: false, message: locationErrorMessage(error) };
    } finally {
      locatingRef.current = false;
      setLocating(false);
    }
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

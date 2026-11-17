/** Request a fresh device fix only after the user explicitly asks for it. */
export function getDeviceLocation(geolocation: Geolocation): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000,
    });
  });
}

export function locationErrorMessage(error: unknown): string {
  const code = (error as { code?: number } | null)?.code;
  if (code === 1) return 'Location permission denied. Allow location access in your browser and device settings, then try again.';
  if (code === 2) return 'Your device could not determine its location. Turn on location services or select a point on the map.';
  if (code === 3) return 'Finding your location timed out. Check location services and try again, preferably outdoors.';
  return 'Unable to get your location. Check browser and device location settings or select a point on the map.';
}

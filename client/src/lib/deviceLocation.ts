/** Ask the device for fresh high-accuracy fixes and keep the best one received.
 * No site can guarantee an exact fix: accuracy depends on the device and OS settings.
 */
export function getDeviceLocation(
  geolocation: Geolocation,
  { waitMs = 45000, improveMs = 8000, permissionWaitMs = 120000, targetAccuracyMeters = 20 } = {}
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let best: GeolocationPosition | undefined;
    let watchId: number | undefined;
    let settled = false;
    let improvementTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (improvementTimer) clearTimeout(improvementTimer);
      if (watchId !== undefined) geolocation.clearWatch(watchId);
      if (error) reject(error);
      else if (best) resolve(best);
      else reject({ code: 3 });
    };
    // The browser's geolocation timeout starts after permission is granted; a
    // shorter JS timer here would expire while the user is reading the prompt.
    const timer = setTimeout(() => finish(), permissionWaitMs);
    try {
      watchId = geolocation.watchPosition(
        (position) => {
          if (settled) return;
          const { latitude, longitude, accuracy } = position.coords;
          if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
              !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
              !Number.isFinite(accuracy) || accuracy < 0 ||
              !Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 10000) return;
          if (!best || accuracy < best.coords.accuracy) best = position;
          if (accuracy <= targetAccuracyMeters) finish();
          else if (!improvementTimer) improvementTimer = setTimeout(() => finish(), improveMs);
        },
        (error) => {
          // The browser's timeout begins after permission. A best fix is usable
          // on timeout; a denial must never return an earlier location.
          if (error.code === 1) finish(error);
          else if (error.code === 3) finish();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: waitMs }
      );
      // Also handle implementations that invoke a callback synchronously.
      if (settled) geolocation.clearWatch(watchId);
    } catch (error) {
      finish(error);
    }
  });
}

export function locationErrorMessage(error: unknown): string {
  const code = (error as { code?: number } | null)?.code;
  if (code === 1) return 'Location permission denied. Allow precise location access in your browser and device settings, then try again.';
  if (code === 2) return 'Your device could not determine its location. Turn on location services or select a point on the map.';
  if (code === 3) return 'Your device did not provide a location. Allow location access, turn on precise location, and try again outdoors. You can also pin the map manually.';
  return 'Unable to get your location. Check browser and device location settings or select a point on the map.';
}

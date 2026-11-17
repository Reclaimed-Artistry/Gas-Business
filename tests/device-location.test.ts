import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceLocation, locationErrorMessage } from '../client/src/lib/deviceLocation';
import { matchNearestPreset } from '../client/src/lib/locations';

test('requests a fresh high-accuracy fix and preserves the device result', async () => {
  const result = { coords: { latitude: 5.019987654, longitude: 7.929876543, accuracy: 17 }, timestamp: 123 };
  const geo = { getCurrentPosition(success: (p: unknown) => void, _error: unknown, options: unknown) {
    assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    success(result);
  }} as unknown as Geolocation;
  assert.equal(await getDeviceLocation(geo), result);
  const pin = matchNearestPreset(result.coords.latitude, result.coords.longitude);
  assert.equal(pin.lat, result.coords.latitude);
  assert.equal(pin.lng, result.coords.longitude);
});

test('permission and device errors remain actionable', async () => {
  for (const code of [1, 2, 3]) {
    const geo = { getCurrentPosition(_success: unknown, error: (e: unknown) => void) { error({ code }); } } as unknown as Geolocation;
    await assert.rejects(getDeviceLocation(geo), (err: { code: number }) => err.code === code);
    assert.match(locationErrorMessage({ code }), /permission|device|timed out/i);
  }
});

test('a distant pin is not mislabelled as a Uyo address', () => {
  const pin = matchNearestPreset(6.5243793, 3.3792057);
  assert.equal(pin.city, 'Unknown city');
  assert.equal(pin.lat, 6.5243793);
  assert.equal(pin.lng, 3.3792057);
});

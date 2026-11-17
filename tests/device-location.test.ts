import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceLocation, locationErrorMessage } from '../client/src/lib/deviceLocation';
import { matchNearestPreset } from '../client/src/lib/locations';

const position = (accuracy: number, lat = 5.019987654, timestamp = Date.now()) =>
  ({ coords: { latitude: lat, longitude: 7.929876543, accuracy }, timestamp }) as GeolocationPosition;

test('waits for a precise fresh fix and retains full coordinates', async () => {
  const precise = position(17);
  let cleared = 0;
  const geo = { watchPosition(success: PositionCallback, _error: PositionErrorCallback, options: PositionOptions) {
    assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 100 });
    queueMicrotask(() => { success(position(150)); success(precise); });
    return 42;
  }, clearWatch(id: number) { assert.equal(id, 42); cleared++; } } as unknown as Geolocation;
  assert.equal(await getDeviceLocation(geo, { waitMs: 100, targetAccuracyMeters: 20 }), precise);
  assert.equal(cleared, 1);
  const pin = matchNearestPreset(precise.coords.latitude, precise.coords.longitude);
  assert.equal(pin.lat, precise.coords.latitude);
  assert.equal(pin.lng, precise.coords.longitude);
});

test('returns the best fix on timeout, ignoring stale and worse readings', async () => {
  const best = position(55);
  let cleared = 0;
  const geo = { watchPosition(success: PositionCallback) {
    queueMicrotask(() => { success(position(1, 0, Date.now() - 60000)); success(position(200)); success(best); success(position(90)); });
    return 7;
  }, clearWatch() { cleared++; } } as unknown as Geolocation;
  assert.equal(await getDeviceLocation(geo, { waitMs: 20, targetAccuracyMeters: 20 }), best);
  assert.equal(cleared, 1);
});

test('permission denial rejects and clears watch', async () => {
  let cleared = 0;
  const geo = { watchPosition(_success: PositionCallback, error: PositionErrorCallback) {
    queueMicrotask(() => error({ code: 1 } as GeolocationPositionError)); return 4;
  }, clearWatch() { cleared++; } } as unknown as Geolocation;
  await assert.rejects(getDeviceLocation(geo, { waitMs: 50 }), (err: { code: number }) => err.code === 1);
  assert.equal(cleared, 1);
  assert.match(locationErrorMessage({ code: 1 }), /permission/i);
});

test('timeout without a fix rejects and clears watch', async () => {
  let cleared = 0;
  const geo = { watchPosition() { return 1; }, clearWatch() { cleared++; } } as unknown as Geolocation;
  await assert.rejects(getDeviceLocation(geo, { waitMs: 10 }), (err: { code: number }) => err.code === 3);
  assert.equal(cleared, 1);
});

test('a distant pin is not mislabelled as a Uyo address', () => {
  const pin = matchNearestPreset(6.5243793, 3.3792057);
  assert.equal(pin.city, 'Unknown city');
  assert.equal(pin.lat, 6.5243793);
  assert.equal(pin.lng, 3.3792057);
});

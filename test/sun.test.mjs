import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clock, daylight, sunPosition, sunVector, timezoneMinutes } from '../src/app/sun.js';

// Hofheim am Taunus, which is where the drawings this was written for are of.
const site = { latitude: 50.09, longitude: 8.45 };
const at = (month, day, minutes) => ({ year: 2026, month, day, minutes });

test('the sun stands where the latitude says it must at noon', () => {
  // Solar noon altitude is 90 less the latitude, plus or minus the tilt of the earth.
  // Nothing about this is approximate: it is what defines the solstices.
  const tilt = 23.44;
  const midsummer = sunPosition(site, at(6, 21, 13 * 60 + 26)).altitude;
  const midwinter = sunPosition(site, at(12, 21, 12 * 60 + 26)).altitude;
  assert.ok(Math.abs(midsummer - (90 - site.latitude + tilt)) < 0.3, `midsummer ${midsummer}`);
  assert.ok(Math.abs(midwinter - (90 - site.latitude - tilt)) < 0.3, `midwinter ${midwinter}`);
  // And at noon it is due south, from anywhere north of the tropics.
  assert.ok(Math.abs(sunPosition(site, at(6, 21, 13 * 60 + 26)).azimuth - 180) < 2);
});

test('summer time is in force between the last Sundays of March and October', () => {
  // An hour of clock is fifteen degrees of sun, so getting this wrong puts a window
  // in shade that should be in full afternoon light.
  assert.equal(timezoneMinutes(2026, 1, 15), 60);
  assert.equal(timezoneMinutes(2026, 6, 21), 120);
  assert.equal(timezoneMinutes(2026, 12, 21), 60);
  // 2026: the last Sunday in March is the 29th, the last in October the 25th.
  assert.equal(timezoneMinutes(2026, 3, 28), 60, 'the Saturday before is still winter');
  assert.equal(timezoneMinutes(2026, 3, 29), 120, 'and the Sunday is not');
  assert.equal(timezoneMinutes(2026, 10, 24), 120);
  assert.equal(timezoneMinutes(2026, 10, 25), 60);
});

test('the day is as long as it is', () => {
  const summer = daylight(site, at(6, 21, 720));
  const winter = daylight(site, at(12, 21, 720));
  const equinox = daylight(site, at(3, 20, 720));
  assert.ok(Math.abs(summer.hours - 16.4) < 0.3, `midsummer ${summer.hours}`);
  assert.ok(Math.abs(winter.hours - 8.1) < 0.3, `midwinter ${winter.hours}`);
  // An equinox is the day the two are equal, which is what the word means.
  assert.ok(Math.abs(equinox.hours - 12.15) < 0.3, `equinox ${equinox.hours}`);
  assert.equal(clock(summer.rise), '05:17');
  assert.equal(clock(summer.set), '21:40');
});

test('the sun rises in the east and sets in the west', () => {
  const dawn = sunPosition(site, at(6, 21, 6 * 60));
  const dusk = sunPosition(site, at(6, 21, 20 * 60));
  assert.ok(dawn.azimuth > 30 && dawn.azimuth < 90, `dawn bears ${dawn.azimuth}`);
  assert.ok(dusk.azimuth > 270 && dusk.azimuth < 330, `dusk bears ${dusk.azimuth}`);
  // And below the horizon in the middle of a winter night.
  assert.ok(sunPosition(site, at(12, 21, 2 * 60)).altitude < -20);
});

test('the direction to the sun lands where the drawing has north', () => {
  // The plan is drawn north up, so north is -y and east is +x.
  const south = sunVector({ altitude: 0, azimuth: 180 });
  assert.ok(south[1] > 0.99, 'due south is +y');
  const east = sunVector({ altitude: 0, azimuth: 90 });
  assert.ok(east[0] > 0.99, 'due east is +x');
  // Overhead is up whichever way it bears.
  assert.ok(sunVector({ altitude: 90, azimuth: 123 })[2] > 0.99);

  // Turning the building turns the sun against it. With the plan's up pointing east,
  // south is a quarter turn clockwise of up — so the sun comes from the plan's right.
  const turned = sunVector({ altitude: 0, azimuth: 180 }, 90);
  assert.ok(turned[0] > 0.99, `turned ${turned}`);
  // Turned the other way it lands on the other side, which is the whole point of it.
  assert.ok(sunVector({ altitude: 0, azimuth: 180 }, 270)[0] < -0.99);
});

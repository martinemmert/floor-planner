// Where the sun actually is.
//
// Not a light rigged to look nice — the real thing, for a real place on a real day.
// The point of a house drawing is to answer questions you cannot answer by standing
// in the plot: whether the winter sun clears the neighbour's roof, whether the room
// you meant to work in faces the afternoon, how long the terrace keeps the light in
// September. That needs the sun in the right place to the degree, so this is the NOAA
// solar position calculation rather than an approximation of it.
//
// Angles are degrees throughout. Azimuth is the compass bearing of the sun, clockwise
// from true north, which is how a compass reads and how a site plan is annotated.

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** A few places, so nobody has to look up their own latitude to try it. */
export const PLACES = [
  { label: 'Hofheim am Taunus', latitude: 50.09, longitude: 8.45 },
  { label: 'Berlin', latitude: 52.52, longitude: 13.4 },
  { label: 'Hamburg', latitude: 53.55, longitude: 9.99 },
  { label: 'München', latitude: 48.14, longitude: 11.58 },
  { label: 'Köln', latitude: 50.94, longitude: 6.96 },
  { label: 'Frankfurt am Main', latitude: 50.11, longitude: 8.68 },
  { label: 'Stuttgart', latitude: 48.78, longitude: 9.18 },
  { label: 'Wien', latitude: 48.21, longitude: 16.37 },
  { label: 'Zürich', latitude: 47.38, longitude: 8.54 },
];

function julianDay(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/**
 * Central European time, including whether summer time is in force.
 *
 * The European rule is the last Sunday in March to the last Sunday in October, and
 * it matters here: an hour of clock time is fifteen degrees of sun, which is the
 * difference between a window in shade and a window in full afternoon light.
 */
export function timezoneMinutes(year, month, day) {
  const lastSunday = (m) => {
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return last - new Date(Date.UTC(year, m - 1, last)).getUTCDay();
  };
  const at = month * 100 + day;
  const from = 300 + lastSunday(3);
  const to = 1000 + lastSunday(10);
  return at >= from && at < to ? 120 : 60;
}

/**
 * The sun's altitude above the horizon and its bearing, for a place and a moment.
 *
 * @param site {latitude, longitude} in degrees, east positive
 * @param when {year, month, day, minutes} local clock time, minutes from midnight
 * @param tzMinutes how far the local clock runs ahead of UTC
 */
export function sunPosition(site, when, tzMinutes) {
  const { year, month, day, minutes } = when;
  const tz = tzMinutes ?? timezoneMinutes(year, month, day);
  const jd = julianDay(year, month, day) + (minutes - tz) / 1440;
  const t = (jd - 2451545) / 36525;

  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = rad(m);
  const centre =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289;
  const trueLong = l0 + centre;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(lambda))));

  // The equation of time: how far the sun runs ahead of or behind the clock, which
  // over a year is a quarter of an hour either way.
  const vary = Math.tan(rad(obliquity / 2)) ** 2;
  const equation =
    4 *
    deg(
      vary * Math.sin(2 * rad(l0)) -
        2 * e * Math.sin(mr) +
        4 * e * vary * Math.sin(mr) * Math.cos(2 * rad(l0)) -
        0.5 * vary * vary * Math.sin(4 * rad(l0)) -
        1.25 * e * e * Math.sin(2 * mr)
    );

  const solarMinutes = (minutes + equation + 4 * site.longitude - tz + 1440 * 3) % 1440;
  const hourAngle = solarMinutes / 4 - 180;
  const latR = rad(site.latitude);
  const decR = rad(declination);
  const haR = rad(hourAngle);
  const cosZenith = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR);
  const zenith = deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
  const altitude = 90 - zenith;

  let azimuth;
  const denom = Math.cos(latR) * Math.sin(rad(zenith));
  if (Math.abs(denom) > 1e-9) {
    let cos = (Math.sin(latR) * Math.cos(rad(zenith)) - Math.sin(decR)) / denom;
    cos = Math.min(1, Math.max(-1, cos));
    azimuth = hourAngle > 0 ? (deg(Math.acos(cos)) + 180) % 360 : (540 - deg(Math.acos(cos))) % 360;
  } else {
    azimuth = site.latitude > 0 ? 180 : 0;
  }
  return { altitude, azimuth, declination, equation };
}

/**
 * When the sun rises and sets, to the minute, by looking for the crossing.
 *
 * Closed forms exist but need their own corrections for refraction and for the days
 * either side of a solstice inside the polar circles. Searching the day the position
 * is already known for is exact by construction and costs nothing worth counting.
 */
export function daylight(site, when) {
  const tz = timezoneMinutes(when.year, when.month, when.day);
  const above = (minutes) => sunPosition(site, { ...when, minutes }, tz).altitude > -0.833;
  let rise = null;
  let set = null;
  let was = above(0);
  for (let minute = 5; minute <= 1440; minute += 5) {
    const now = above(minute);
    if (now !== was) {
      // Narrow the five minutes down to the minute.
      let lo = minute - 5;
      let hi = minute;
      while (hi - lo > 1) {
        const mid = Math.round((lo + hi) / 2);
        if (above(mid) === was) lo = mid;
        else hi = mid;
      }
      if (now) rise = hi;
      else set = hi;
      was = now;
    }
  }
  return { rise, set, hours: rise !== null && set !== null ? (set - rise) / 60 : was ? 24 : 0 };
}

/**
 * The direction towards the sun, in the drawing's own coordinates.
 *
 * The plan is drawn with north up unless it says otherwise, so -y is north and +x is
 * east. `bearing` turns the building against that: the compass bearing of the
 * direction the plan calls up, which is what a site plan's north point tells you.
 */
export function sunVector(position, bearing = 0) {
  const altitude = rad(position.altitude);
  const azimuth = rad(position.azimuth - bearing);
  const flat = Math.cos(altitude);
  return [Math.sin(azimuth) * flat, -Math.cos(azimuth) * flat, Math.sin(altitude)];
}

export const SEASONS = [
  { id: 'midwinter', label: 'Midwinter', month: 12, day: 21 },
  { id: 'spring', label: 'Equinox, spring', month: 3, day: 20 },
  { id: 'midsummer', label: 'Midsummer', month: 6, day: 21 },
  { id: 'autumn', label: 'Equinox, autumn', month: 9, day: 22 },
];

/** A clock time as people write it. */
export function clock(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---- the calendar, for the sliders --------------------------------------

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function dayOfYear(month, day) {
  let n = day;
  for (let m = 1; m < month; m++) n += MONTH_DAYS[m - 1];
  return Math.min(365, Math.max(1, n));
}

export function fromDayOfYear(n) {
  let left = Math.min(365, Math.max(1, Math.round(n)));
  for (let m = 1; m <= 12; m++) {
    if (left <= MONTH_DAYS[m - 1]) return { month: m, day: left };
    left -= MONTH_DAYS[m - 1];
  }
  return { month: 12, day: 31 };
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(bearing) {
  return POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

/**
 * The compass bearing a direction on the plan points in.
 *
 * The plan is drawn with its own up, and `bearing` says what that up is on a compass,
 * so everything else follows from it.
 */
export function bearingOf(dx, dy, planBearing = 0) {
  return (((planBearing + deg(Math.atan2(dx, -dy))) % 360) + 360) % 360;
}

/**
 * How long the sun is on each window today, and between which hours.
 *
 * A window can only see the sun while the sun is above the horizon and on its side of
 * the wall. That is the honest limit of what the drawing knows — it has no idea about
 * the neighbour's beech tree or the hill behind the house, and it says so.
 */
export function windowSunHours(plan, site, when, geometryOf) {
  const openings = (plan.openings ?? []).filter((o) => (o.kind ?? 'door') === 'window');
  if (!openings.length) return [];
  const step = 10;
  const rows = [];
  let index = 0;
  for (const opening of openings) {
    const geo = geometryOf(plan, opening);
    if (!geo) continue;
    index += 1;
    // A window faces out of the building: of the wall's two normals, the one pointing
    // away from the middle of the plan.
    const mid = planCentre(plan, geometryOf);
    const cx = geo.x1 + geo.dx * 500 - mid.x;
    const cy = geo.y1 + geo.dy * 500 - mid.y;
    const outward = geo.nx * cx + geo.ny * cy >= 0 ? [geo.nx, geo.ny] : [-geo.nx, -geo.ny];
    const facing = bearingOf(outward[0], outward[1], site.bearing ?? 0);

    let minutes = 0;
    let from = null;
    let to = null;
    for (let t = 0; t < 1440; t += step) {
      const position = sunPosition(site, { ...when, minutes: t });
      if (position.altitude <= 0) continue;
      const off = Math.abs((((position.azimuth - facing + 540) % 360) - 180));
      if (off >= 90) continue; // behind the wall
      minutes += step;
      if (from === null) from = t;
      to = t + step;
    }
    rows.push({
      name: opening.mark || `W${index}`,
      faces: compassPoint(facing),
      hours: minutes / 60,
      from,
      to,
    });
  }
  return rows.sort((a, b) => b.hours - a.hours);
}

function planCentre(plan, geometryOf) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const node of plan.nodes ?? []) {
    x += node.x;
    y += node.y;
    n += 1;
  }
  return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
}

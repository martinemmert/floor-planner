// Scale inference. A dimension chain states a real length in text next to the
// line it measures, so the ratio between the two gives millimetres per PDF
// point. Candidates are cross-checked against the scales architects actually
// draw at, which also settles whether "374" means centimetres or millimetres.

import { median, pointSegDistance, segAngle, segLength, angleDelta } from './vec.js';

const PT_PER_MM = 72 / 25.4;
export const STANDARD_SCALES = [10, 20, 25, 33.33, 50, 100, 200, 250, 500, 1000];

// How many dimensions have to agree before a reading is believed.
const MIN_AGREEING = 3;

export function mmPerPtForScale(denominator) {
  return denominator / PT_PER_MM;
}

export function scaleForMmPerPt(mmPerPt) {
  return mmPerPt * PT_PER_MM;
}

// "3,74" / "3.74" / "374" / "12,5" — anything that reads as a measurement.
export function parseMeasurement(str) {
  const trimmed = str.trim().replace(/\s+/g, '');
  const m = /^([0-9]{1,5})(?:[.,]([0-9]{1,3}))?$/.exec(trimmed);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2];
  const value = parseFloat(`${whole}.${frac ?? 0}`);
  if (!Number.isFinite(value) || value <= 0) return null;
  const options = [];
  if (frac !== undefined) {
    // A decimal separator means metres in practice ("3,74"), sometimes
    // centimetres for small values.
    options.push(value * 1000);
    if (value < 100) options.push(value * 10);
  } else if (whole.length >= 3) {
    options.push(value * 10); // centimetres, the German convention
    options.push(value); // millimetres
  } else {
    options.push(value * 1000); // metres
    options.push(value * 10);
  }
  return { value, options, hasFraction: frac !== undefined, digits: whole.length };
}

function nearestStandard(denominator) {
  let best = null;
  for (const s of STANDARD_SCALES) {
    const error = Math.abs(Math.log(denominator / s));
    if (!best || error < best.error) best = { scale: s, error };
  }
  return best;
}

/**
 * @param segments extracted segments in points
 * @param texts extracted text items in points
 * @returns {{mmPerPt, denominator, confidence, samples}}
 */
export function inferScale(segments, texts) {
  const candidates = [];
  const numeric = [];
  for (const text of texts) {
    const parsed = parseMeasurement(text.str);
    if (parsed) numeric.push({ text, parsed });
  }

  for (const { text, parsed } of numeric) {
    const reach = Math.max(text.size * 6, 12);
    let bestSeg = null;
    let bestScore = Infinity;
    for (const seg of segments) {
      const len = segLength(seg);
      if (len < 4) continue;
      const mx = (seg.x1 + seg.x2) / 2;
      const my = (seg.y1 + seg.y2) / 2;
      const gap = pointSegDistance(text.x + (text.width ?? 0) / 2, text.y, seg);
      if (gap > reach) continue;
      // The measured line runs along the text baseline.
      const alignment = angleDelta(segAngle(seg), Math.abs(text.angle ?? 0) % Math.PI);
      if (alignment > 0.2) continue;
      const centreGap = Math.hypot(mx - (text.x + (text.width ?? 0) / 2), my - text.y);
      const score = gap + centreGap * 0.5;
      if (score < bestScore) {
        bestScore = score;
        bestSeg = seg;
      }
    }
    if (!bestSeg) continue;
    const lengthPt = segLength(bestSeg);
    for (const mm of parsed.options) {
      const mmPerPt = mm / lengthPt;
      const denominator = scaleForMmPerPt(mmPerPt);
      if (denominator < 5 || denominator > 2000) continue;
      const near = nearestStandard(denominator);
      candidates.push({ mmPerPt, denominator, error: near.error, standard: near.scale, text: text.str });
    }
  }

  if (candidates.length === 0) {
    return { mmPerPt: mmPerPtForScale(100), denominator: 100, confidence: 0, samples: 0, guessed: true };
  }

  // Group candidates by the standard scale they agree with, then take the
  // group with the most agreement and the tightest fit.
  const groups = new Map();
  for (const c of candidates) {
    const list = groups.get(c.standard) ?? [];
    list.push(c);
    groups.set(c.standard, list);
  }
  let best = null;
  for (const [standard, list] of groups) {
    const tight = list.filter((c) => c.error < 0.08);
    const score = tight.length * 2 + list.length * 0.1;
    if (!best || score > best.score) {
      best = { standard, list, tight, score };
    }
  }
  const useList = best.tight.length ? best.tight : best.list;
  // One or two matches is coincidence, not a reading. CAD exporters often draw the
  // dimension figures as outlines rather than text, in which case there is nothing
  // to read at all and the scale has to be measured instead.
  if (best.tight.length < MIN_AGREEING) {
    return {
      mmPerPt: mmPerPtForScale(100),
      denominator: 100,
      confidence: 0,
      samples: best.tight.length,
      guessed: true,
    };
  }
  const mmPerPt = median(useList.map((c) => c.mmPerPt));
  const denominator = scaleForMmPerPt(mmPerPt);
  const near = nearestStandard(denominator);
  const snapped = near.error < 0.03 ? mmPerPtForScale(near.scale) : mmPerPt;
  return {
    mmPerPt: snapped,
    denominator: scaleForMmPerPt(snapped),
    confidence: Math.min(1, useList.length / 6),
    samples: useList.length,
    guessed: false,
  };
}

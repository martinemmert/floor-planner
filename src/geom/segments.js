// Flattens extracted PDF paths into plain line segments. Used only to build the
// faint tracing backdrop, so the geometry is kept as-is: no classification, no
// interpretation.

export function buildSegments(paths, options = {}) {
  const lightest = options.lightest ?? 0.86;
  const segments = [];
  paths.forEach((path, pathIndex) => {
    if (path.gray > lightest) return; // background wash
    const pts = path.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) continue;
      segments.push({ id: segments.length, x1, y1, x2, y2, w: path.w, gray: path.gray, pathIndex });
    }
  });
  return segments;
}

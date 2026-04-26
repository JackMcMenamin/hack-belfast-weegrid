export type LatLon = { lat: number; lon: number };

export function distanceMeters(
  a: LatLon,
  b: LatLon,
): number {
  const latFactor = 111_320;
  const lonFactor = Math.cos((a.lat * Math.PI) / 180) * 111_320;
  const dx = (b.lon - a.lon) * lonFactor;
  const dy = (b.lat - a.lat) * latFactor;
  return Math.sqrt(dx * dx + dy * dy);
}

function cross(o: LatLon, a: LatLon, b: LatLon): number {
  return (
    (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon)
  );
}

export function convexHull(points: LatLon[]): LatLon[] {
  if (points.length < 3) {
    return [...points];
  }

  const sorted = [...points].sort((a, b) =>
    a.lon === b.lon ? a.lat - b.lat : a.lon - b.lon,
  );

  const lower: LatLon[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: LatLon[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export function expandHull(
  hull: LatLon[],
  metersOutward: number,
): LatLon[] {
  if (hull.length === 0) {
    return hull;
  }

  const centroid = hull.reduce(
    (acc, point) => ({
      lat: acc.lat + point.lat / hull.length,
      lon: acc.lon + point.lon / hull.length,
    }),
    { lat: 0, lon: 0 },
  );

  const latFactor = 111_320;
  const lonFactor = Math.cos((centroid.lat * Math.PI) / 180) * 111_320;

  return hull.map((point) => {
    const dx = (point.lon - centroid.lon) * lonFactor;
    const dy = (point.lat - centroid.lat) * latFactor;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      return point;
    }
    const scale = (length + metersOutward) / length;
    return {
      lat: centroid.lat + (dy * scale) / latFactor,
      lon: centroid.lon + (dx * scale) / lonFactor,
    };
  });
}

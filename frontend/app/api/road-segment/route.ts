import { NextRequest, NextResponse } from "next/server";
import { runOverpass } from "@/lib/overpass";

type OverpassNode = {
  lat: number;
  lon: number;
};

type OverpassElement = {
  type: "way";
  id: number;
  tags?: {
    name?: string;
    highway?: string;
  };
  geometry?: OverpassNode[];
};

type OverpassResponse = {
  elements: OverpassElement[];
};

function fallbackRoadSegment(latitude: number, longitude: number) {
  return {
    roadName: "Local street segment",
    centerIndex: 1,
    snapDistanceMeters: 0,
    usedFallback: true,
    coordinates: [
      [latitude, longitude - 0.0012],
      [latitude, longitude],
      [latitude, longitude + 0.0012],
    ],
  };
}

function pointToSegmentDistanceMeters(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const latFactor = 111_320;
  const lonFactor = Math.cos((pLat * Math.PI) / 180) * 111_320;

  const px = pLon * lonFactor;
  const py = pLat * latFactor;
  const ax = aLon * lonFactor;
  const ay = aLat * latFactor;
  const bx = bLon * lonFactor;
  const by = bLat * latFactor;

  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;

  if (abLenSq === 0) {
    const dx = px - ax;
    const dy = py - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const projX = ax + t * abx;
  const projY = ay + t * aby;

  const dx = px - projX;
  const dy = py - projY;
  return Math.sqrt(dx * dx + dy * dy);
}

function findClosestRoad(
  roads: OverpassElement[],
  latitude: number,
  longitude: number,
) {
  let bestRoad: OverpassElement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  let bestNodeIndex = 0;

  for (const road of roads) {
    if (!road.geometry || road.geometry.length < 2) {
      continue;
    }

    for (let i = 0; i < road.geometry.length - 1; i += 1) {
      const a = road.geometry[i];
      const b = road.geometry[i + 1];
      const distance = pointToSegmentDistanceMeters(
        latitude,
        longitude,
        a.lat,
        a.lon,
        b.lat,
        b.lon,
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestRoad = road;
        bestIndex = i;
        const distanceToA = pointToSegmentDistanceMeters(
          latitude,
          longitude,
          a.lat,
          a.lon,
          a.lat,
          a.lon,
        );
        const distanceToB = pointToSegmentDistanceMeters(
          latitude,
          longitude,
          b.lat,
          b.lon,
          b.lat,
          b.lon,
        );
        bestNodeIndex = distanceToA <= distanceToB ? i : i + 1;
      }
    }
  }

  return { bestRoad, bestDistance, bestIndex, bestNodeIndex };
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: "lat and lon query params are required." },
      { status: 400 },
    );
  }

  const overpassQuery = `
    [out:json][timeout:20];
    way(around:350,${lat},${lon})["highway"]["name"];
    out geom;
  `;

  const overpassResult = await runOverpass<OverpassResponse>(overpassQuery);

  if (!overpassResult.ok) {
    return NextResponse.json({
      ...fallbackRoadSegment(lat, lon),
      attemptedEndpoints: overpassResult.attempts,
    });
  }

  const data = overpassResult.data;
  const roads = (data.elements ?? []).filter(
    (element) => element.type === "way" && (element.geometry?.length ?? 0) > 1,
  );

  if (!roads.length) {
    return NextResponse.json(fallbackRoadSegment(lat, lon));
  }

  const { bestRoad, bestDistance, bestIndex, bestNodeIndex } = findClosestRoad(
    roads,
    lat,
    lon,
  );

  if (!bestRoad || !bestRoad.geometry) {
    return NextResponse.json(fallbackRoadSegment(lat, lon));
  }

  return NextResponse.json({
    roadName: bestRoad.tags?.name ?? "Nearby street",
    centerIndex: Number.isFinite(bestNodeIndex) ? bestNodeIndex : bestIndex,
    snapDistanceMeters: Math.round(bestDistance),
    coordinates: bestRoad.geometry.map((point) => [point.lat, point.lon]),
  });
}

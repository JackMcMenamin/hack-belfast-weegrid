import json
import math
from dataclasses import dataclass
from typing import Any, Literal
from urllib import error, parse, request

from pydantic import BaseModel

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

TARGET_HOMES_MIN = 50
TARGET_HOMES_MAX = 150
ABSOLUTE_MIN_HOMES = 20
ABSOLUTE_MAX_HOMES = 250


@dataclass
class LatLon:
    lat: float
    lon: float


AreaType = Literal["village", "neighbourhood", "street", "district"]


class Building(BaseModel):
    lat: float
    lon: float
    residential: bool


class HullPoint(BaseModel):
    lat: float
    lon: float


class ClusterResponse(BaseModel):
    center: dict[str, float]
    areaLabel: str
    areaType: AreaType
    totalBuildingsDetected: int
    residentialDetected: int
    buildings: list[Building]
    defaultSelectedHomes: int
    recommendedRangeMin: int
    recommendedRangeMax: int
    hull: list[HullPoint]
    searchRadiusMeters: int
    usedFallback: bool
    attemptedEndpoints: list[dict[str, str]] | None = None


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat_factor = 111_320
    lon_factor = math.cos(math.radians(lat1)) * 111_320
    dx = (lon2 - lon1) * lon_factor
    dy = (lat2 - lat1) * lat_factor
    return math.sqrt(dx * dx + dy * dy)


def _cross(o: LatLon, a: LatLon, b: LatLon) -> float:
    return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon)


def convex_hull(points: list[LatLon]) -> list[LatLon]:
    if len(points) < 3:
        return list(points)

    sorted_pts = sorted(points, key=lambda p: (p.lon, p.lat))

    lower: list[LatLon] = []
    for pt in sorted_pts:
        while len(lower) >= 2 and _cross(lower[-2], lower[-1], pt) <= 0:
            lower.pop()
        lower.append(pt)

    upper: list[LatLon] = []
    for pt in reversed(sorted_pts):
        while len(upper) >= 2 and _cross(upper[-2], upper[-1], pt) <= 0:
            upper.pop()
        upper.append(pt)

    upper.pop()
    lower.pop()
    return lower + upper


def expand_hull(hull: list[LatLon], meters_outward: float) -> list[LatLon]:
    if len(hull) == 0:
        return hull

    centroid_lat = sum(p.lat for p in hull) / len(hull)
    centroid_lon = sum(p.lon for p in hull) / len(hull)
    lat_factor = 111_320
    lon_factor = math.cos(math.radians(centroid_lat)) * 111_320

    expanded: list[LatLon] = []
    for pt in hull:
        dx = (pt.lon - centroid_lon) * lon_factor
        dy = (pt.lat - centroid_lat) * lat_factor
        length = math.sqrt(dx * dx + dy * dy)
        if length == 0:
            expanded.append(pt)
            continue
        scale = (length + meters_outward) / length
        expanded.append(
            LatLon(
                lat=centroid_lat + (dy * scale) / lat_factor,
                lon=centroid_lon + (dx * scale) / lon_factor,
            )
        )
    return expanded


def run_overpass(query: str) -> dict[str, Any] | None:
    encoded_query = parse.urlencode({"data": query}).encode("utf-8")
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            req = request.Request(
                endpoint,
                data=encoded_query,
                headers={
                    "User-Agent": "WeeGrid-HackBelfast/1.0",
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                },
            )
            with request.urlopen(req, timeout=20) as response:
                data = json.loads(response.read().decode("utf-8"))
                if isinstance(data, dict):
                    return data
        except (error.HTTPError, error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError, OSError):
            continue
    return None


def build_overpass_query(lat: float, lon: float, radius: int) -> str:
    return f"""
    [out:json][timeout:25];
    (
      way(around:{radius},{lat},{lon})["building"];
      relation(around:{radius},{lat},{lon})["building"];
    );
    out center tags;
    """


def build_area_name_query(lat: float, lon: float) -> str:
    return f"""
    [out:json][timeout:15];
    is_in({lat},{lon})->.a;
    (
      area.a["place"~"village|hamlet|suburb|neighbourhood|town"];
      area.a["boundary"="administrative"]["admin_level"~"^(8|9|10|11)$"];
    );
    out tags;
    """


def pick_area_label(areas: list[dict[str, Any]], fallback: str) -> dict[str, str]:
    by_priority = [element.get("tags", {}) for element in areas if element.get("tags", {}).get("name")]

    for tags in by_priority:
        if tags.get("place") == "village" and tags.get("name"):
            return {"label": tags["name"], "type": "village"}
    for tags in by_priority:
        if tags.get("place") == "hamlet" and tags.get("name"):
            return {"label": tags["name"], "type": "village"}
    for tags in by_priority:
        if tags.get("place") == "suburb" and tags.get("name"):
            return {"label": tags["name"], "type": "neighbourhood"}
    for tags in by_priority:
        if tags.get("place") == "neighbourhood" and tags.get("name"):
            return {"label": tags["name"], "type": "neighbourhood"}
    for tags in by_priority:
        if tags.get("place") == "town" and tags.get("name"):
            return {"label": tags["name"], "type": "neighbourhood"}
    for tags in by_priority:
        if tags.get("boundary") == "administrative" and tags.get("admin_level") == "10" and tags.get("name"):
            return {"label": tags["name"], "type": "neighbourhood"}

    return {"label": fallback, "type": "neighbourhood"}


def element_to_building(element: dict[str, Any], center_lat: float, center_lon: float) -> dict[str, Any] | None:
    lat: float | None = None
    lon: float | None = None

    if element.get("type") == "node":
        lat = element.get("lat")
        lon = element.get("lon")
    elif "center" in element:
        center_obj = element["center"]
        if isinstance(center_obj, dict):
            lat = center_obj.get("lat")
            lon = center_obj.get("lon")

    if lat is None or lon is None:
        return None

    tags = element.get("tags", {})
    building_tag = tags.get("building", "")

    residential_tags = {
        "yes",
        "house",
        "residential",
        "detached",
        "semidetached_house",
        "terrace",
        "apartments",
        "bungalow",
        "dormitory",
    }
    non_residential = {
        "industrial",
        "warehouse",
        "commercial",
        "retail",
        "office",
        "school",
        "church",
        "hospital",
        "garage",
        "garages",
        "farm_auxiliary",
        "barn",
        "shed",
        "stable",
        "construction",
    }

    is_residential = building_tag in residential_tags or (building_tag not in non_residential and building_tag != "")

    distance = haversine_meters(center_lat, center_lon, lat, lon)
    return {"lat": lat, "lon": lon, "distance": distance, "residential": is_residential}


def fallback_cluster(lat: float, lon: float, fallback_name: str, attempts: list[dict[str, str]]) -> ClusterResponse:
    fallback_homes = 90
    offsets: list[LatLon] = []
    for i in range(fallback_homes):
        angle = (i / fallback_homes) * math.pi * 2
        radius = 80 + (i % 10) * 9
        dy = math.sin(angle) * radius / 111_320
        dx = math.cos(angle) * radius / (math.cos(math.radians(lat)) * 111_320)
        offsets.append(LatLon(lat=lat + dy, lon=lon + dx))

    hull = expand_hull(convex_hull(offsets), 30)

    return ClusterResponse(
        center={"latitude": lat, "longitude": lon},
        areaLabel=fallback_name,
        areaType="neighbourhood",
        totalBuildingsDetected=fallback_homes,
        residentialDetected=fallback_homes,
        buildings=[Building(lat=pt.lat, lon=pt.lon, residential=True) for pt in offsets],
        defaultSelectedHomes=90,
        recommendedRangeMin=TARGET_HOMES_MIN,
        recommendedRangeMax=TARGET_HOMES_MAX,
        hull=[HullPoint(lat=pt.lat, lon=pt.lon) for pt in hull],
        searchRadiusMeters=350,
        usedFallback=True,
        attemptedEndpoints=attempts if attempts else None,
    )


def fetch_cluster(lat: float, lon: float, fallback_label: str) -> ClusterResponse:
    center = LatLon(lat=lat, lon=lon)
    building_result = run_overpass(build_overpass_query(lat, lon, 700))

    if not building_result or "elements" not in building_result:
        return fallback_cluster(lat, lon, fallback_label, [{"endpoint": "all", "reason": "no response"}])

    elements = building_result.get("elements", [])
    buildings_raw = [element_to_building(el, lat, lon) for el in elements]
    buildings = [b for b in buildings_raw if b is not None]
    buildings.sort(key=lambda b: b["distance"])

    if len(buildings) == 0:
        return fallback_cluster(lat, lon, fallback_label, [])

    total_buildings = len(buildings)
    residential_buildings = [b for b in buildings if b["residential"]]
    residential_count = len(residential_buildings)

    use_residential_list = residential_count >= TARGET_HOMES_MIN
    building_list = residential_buildings if use_residential_list else buildings

    target = max(TARGET_HOMES_MIN, min(TARGET_HOMES_MAX, round(len(building_list) * 0.7)))
    capped_default = min(target, len(building_list))
    default_selected_homes = max(ABSOLUTE_MIN_HOMES, capped_default)

    recommended_min = max(ABSOLUTE_MIN_HOMES, min(TARGET_HOMES_MIN, len(building_list)))
    recommended_max = min(ABSOLUTE_MAX_HOMES, max(recommended_min, len(building_list)))

    selected_subset = building_list[:default_selected_homes]
    hull_points = [LatLon(lat=b["lat"], lon=b["lon"]) for b in selected_subset]
    hull = expand_hull(convex_hull(hull_points), 25)

    try:
        area_result = run_overpass(build_area_name_query(lat, lon))
        if area_result and "elements" in area_result:
            area_info = pick_area_label(area_result["elements"], fallback_label)
        else:
            area_info = {"label": fallback_label, "type": "neighbourhood"}
    except Exception:
        # If area lookup fails, use fallback
        area_info = {"label": fallback_label, "type": "neighbourhood"}

    farthest = selected_subset[-1] if selected_subset else None
    search_radius = max(100, round(farthest["distance"])) if farthest else 250

    return ClusterResponse(
        center={"latitude": lat, "longitude": lon},
        areaLabel=area_info["label"],
        areaType=area_info["type"],
        totalBuildingsDetected=total_buildings,
        residentialDetected=residential_count,
        buildings=[Building(lat=b["lat"], lon=b["lon"], residential=b["residential"]) for b in building_list],
        defaultSelectedHomes=default_selected_homes,
        recommendedRangeMin=recommended_min,
        recommendedRangeMax=recommended_max,
        hull=[HullPoint(lat=pt.lat, lon=pt.lon) for pt in hull],
        searchRadiusMeters=search_radius,
        usedFallback=False,
    )

import json
import math
from dataclasses import dataclass
from typing import Any, Literal
from urllib import error, parse, request

from pydantic import BaseModel

Status = Literal["great", "good", "mixed", "rough"]

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]


class GeoPoint(BaseModel):
    lat: float
    lon: float


class InquiryRequest(BaseModel):
    areaLabel: str
    centerLat: float
    centerLon: float
    selectedHomes: int
    solarYieldKwhPerKw: float | None = None
    selectedBuildings: list[GeoPoint] = []
    hull: list[GeoPoint] = []


class InquiryCheck(BaseModel):
    id: str
    title: str
    dataset: str
    datasetDescription: str
    methodology: str
    interpretation: str
    status: Status
    score: int
    message: str


class InquiryResponse(BaseModel):
    areaLabel: str
    overallScore: int
    verdict: str
    checks: list[InquiryCheck]
    usedFallbackSignals: bool


@dataclass
class ScoredSignal:
    score: int
    status: Status
    message: str


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def infer_status(score: int) -> Status:
    if score >= 80:
        return "great"
    if score >= 65:
        return "good"
    if score >= 45:
        return "mixed"
    return "rough"


def haversine_meters(a_lat: float, a_lon: float, b_lat: float, b_lon: float) -> float:
    radius_earth = 6_371_000
    d_lat = math.radians(b_lat - a_lat)
    d_lon = math.radians(b_lon - a_lon)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat))
        * math.cos(math.radians(b_lat))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_earth * c


def infer_radius_meters(payload: InquiryRequest) -> int:
    if payload.selectedBuildings:
        farthest = max(
            haversine_meters(payload.centerLat, payload.centerLon, point.lat, point.lon)
            for point in payload.selectedBuildings
        )
        return int(clamp(farthest * 1.35, 220, 1300))
    if payload.hull:
        farthest = max(
            haversine_meters(payload.centerLat, payload.centerLon, point.lat, point.lon)
            for point in payload.hull
        )
        return int(clamp(farthest * 1.4, 220, 1300))
    return 550


def fetch_json(url: str, method: str = "GET", body: bytes | None = None) -> Any | None:
    try:
        req = request.Request(
            url,
            method=method,
            data=body,
            headers={
                "User-Agent": "WeeGrid-HackBelfast/1.0",
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            },
        )
        with request.urlopen(req, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except (error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def run_overpass(query: str) -> dict[str, Any] | None:
    payload = parse.urlencode({"data": query}).encode("utf-8")
    for endpoint in OVERPASS_ENDPOINTS:
        data = fetch_json(endpoint, method="POST", body=payload)
        if isinstance(data, dict):
            return data
    return None


def score_solar_resource(solar_yield_kwh_per_kw: float | None) -> ScoredSignal:
    value = solar_yield_kwh_per_kw if solar_yield_kwh_per_kw is not None else 820
    if value >= 950:
        score = 94
    elif value >= 860:
        score = 83
    elif value >= 780:
        score = 70
    elif value >= 700:
        score = 56
    else:
        score = 38
    suffix = "" if solar_yield_kwh_per_kw is not None else " (fallback NI average used)"
    return ScoredSignal(
        score=score,
        status=infer_status(score),
        message=f"PVGIS yield signal is ~{round(value)} kWh/kWp/year{suffix}.",
    )


def score_tree_cover(lat: float, lon: float, radius: int, selected_homes: int) -> ScoredSignal:
    query = f"""
    [out:json][timeout:20];
    (
      node(around:{radius},{lat},{lon})["natural"="tree"];
      way(around:{radius},{lat},{lon})["natural"="wood"];
      way(around:{radius},{lat},{lon})["landuse"="forest"];
      way(around:{radius},{lat},{lon})["leisure"="park"];
    );
    out tags center;
    """
    data = run_overpass(query)
    if not data or "elements" not in data:
        return ScoredSignal(
            score=60,
            status="mixed",
            message="Tree/shading dataset unavailable right now; using neutral score.",
        )

    vegetation_points = 0
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if element.get("type") == "node" and tags.get("natural") == "tree":
            vegetation_points += 1
        elif tags.get("natural") == "wood":
            vegetation_points += 12
        elif tags.get("landuse") == "forest":
            vegetation_points += 14
        elif tags.get("leisure") == "park":
            vegetation_points += 8

    pressure = vegetation_points / max(1, selected_homes)
    if pressure < 0.15:
        score = 90
    elif pressure < 0.35:
        score = 76
    elif pressure < 0.65:
        score = 58
    elif pressure < 1.1:
        score = 40
    else:
        score = 24

    return ScoredSignal(
        score=score,
        status=infer_status(score),
        message=(
            f"Vegetation shading pressure is {pressure:.2f} points/home "
            "(lower is better). 0.00 means almost no mapped shading pressure."
        ),
    )


def score_built_form(lat: float, lon: float, radius: int) -> ScoredSignal:
    query = f"""
    [out:json][timeout:20];
    (
      way(around:{radius},{lat},{lon})["building"];
      relation(around:{radius},{lat},{lon})["building"];
    );
    out tags center;
    """
    data = run_overpass(query)
    if not data or "elements" not in data:
        return ScoredSignal(
            score=60,
            status="mixed",
            message="Building form dataset unavailable; using neutral score.",
        )

    elements = data.get("elements", [])
    if not elements:
        return ScoredSignal(
            score=55,
            status="mixed",
            message="No building form records were returned for this radius.",
        )

    residential_like = {
        "house",
        "detached",
        "semidetached_house",
        "terrace",
        "residential",
        "bungalow",
        "apartments",
    }
    tall_count = 0
    residential_count = 0
    for element in elements:
        tags = element.get("tags", {})
        building_type = tags.get("building", "")
        levels_raw = tags.get("building:levels")
        height_raw = tags.get("height")
        levels = 0.0
        height = 0.0
        try:
            levels = float(levels_raw) if levels_raw else 0.0
        except ValueError:
            levels = 0.0
        try:
            height = float(str(height_raw).replace("m", "").strip()) if height_raw else 0.0
        except ValueError:
            height = 0.0

        if building_type in residential_like:
            residential_count += 1
        if levels >= 5 or height >= 15:
            tall_count += 1

    total = len(elements)
    residential_share = residential_count / total
    tall_ratio = tall_count / total
    score_raw = 52 + residential_share * 34 - tall_ratio * 38
    score = int(round(clamp(score_raw, 18, 95)))
    return ScoredSignal(
        score=score,
        status=infer_status(score),
        message=(
            f"Built-form suitability: {residential_share * 100:.0f}% residential-like "
            f"and {tall_ratio * 100:.0f}% taller blocks."
        ),
    )


def _segment_bearing_degrees(a: dict[str, float], b: dict[str, float]) -> float:
    dy = b["lat"] - a["lat"]
    dx = b["lon"] - a["lon"]
    angle = math.degrees(math.atan2(dy, dx))
    normalized = (angle + 360) % 180
    return normalized


def score_orientation_proxy(lat: float, lon: float, radius: int) -> ScoredSignal:
    query = f"""
    [out:json][timeout:20];
    (
      way(around:{radius},{lat},{lon})["highway"~"residential|living_street|tertiary|secondary|primary|unclassified"];
    );
    out geom;
    """
    data = run_overpass(query)
    if not data or "elements" not in data:
        return ScoredSignal(
            score=60,
            status="mixed",
            message="Street-orientation dataset unavailable; using neutral score.",
        )

    bearings: list[float] = []
    for way in data.get("elements", []):
        geom = way.get("geometry", [])
        for i in range(len(geom) - 1):
            a = geom[i]
            b = geom[i + 1]
            if "lat" in a and "lon" in a and "lat" in b and "lon" in b:
                bearings.append(_segment_bearing_degrees(a, b))

    if len(bearings) < 12:
        return ScoredSignal(
            score=58,
            status="mixed",
            message="Not enough orientation geometry found; confidence is limited.",
        )

    east_west = sum(1 for bearing in bearings if 65 <= bearing <= 115) / len(bearings)
    north_south = sum(1 for bearing in bearings if bearing <= 25 or bearing >= 155) / len(
        bearings
    )
    diversity = 1 - abs(east_west - north_south)
    score = int(round(clamp(52 + diversity * 42, 25, 94)))

    dominant = "mixed grid"
    if east_west > 0.62:
        dominant = "east-west dominant"
    elif north_south > 0.62:
        dominant = "north-south dominant"

    return ScoredSignal(
        score=score,
        status=infer_status(score),
        message=(
            f"Street orientation proxy is {dominant}; diversity={diversity:.2f} "
            "for roof-orientation flexibility."
        ),
    )


def score_cloud_cover(lat: float, lon: float) -> ScoredSignal:
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat:.6f}&longitude={lon:.6f}"
        "&daily=cloud_cover_mean&timezone=auto&forecast_days=7"
    )
    data = fetch_json(url, method="GET")
    daily = data.get("daily") if isinstance(data, dict) else None
    cloud_values = daily.get("cloud_cover_mean") if isinstance(daily, dict) else None
    if not isinstance(cloud_values, list) or not cloud_values:
        return ScoredSignal(
            score=60,
            status="mixed",
            message="Cloud-cover dataset unavailable; using neutral weather score.",
        )

    average_cloud = sum(float(value) for value in cloud_values) / len(cloud_values)
    score = int(round(clamp(100 - average_cloud, 20, 95)))
    return ScoredSignal(
        score=score,
        status=infer_status(score),
        message=f"Near-term cloud-cover signal averages {average_cloud:.0f}% over 7 days.",
    )


def build_verdict(score: int) -> str:
    if score >= 82:
        return "Excellent candidate - this cluster looks strong for a community solar rollout."
    if score >= 68:
        return "Promising candidate - solid fundamentals with a few watch-outs."
    if score >= 48:
        return "Borderline candidate - doable, but design and financing need care."
    return "Bit of a shitshow right now - major blockers likely without redesign."


def analyze_cluster(payload: InquiryRequest) -> InquiryResponse:
    radius = infer_radius_meters(payload)
    solar = score_solar_resource(payload.solarYieldKwhPerKw)
    tree_cover = score_tree_cover(
        payload.centerLat, payload.centerLon, radius, payload.selectedHomes
    )
    built_form = score_built_form(payload.centerLat, payload.centerLon, radius)
    orientation = score_orientation_proxy(payload.centerLat, payload.centerLon, radius)
    cloud_cover = score_cloud_cover(payload.centerLat, payload.centerLon)

    checks = [
        InquiryCheck(
            id="solar-resource",
            title="Solar Resource",
            dataset="PVGIS",
            datasetDescription=(
                "European Commission PVGIS gridded irradiance and PV output modeling."
            ),
            methodology=(
                "Uses annual kWh/kWp yield for the cluster centroid and maps it to a score band."
            ),
            interpretation=(
                "Higher annual yield means stronger baseline generation potential."
            ),
            status=solar.status,
            score=solar.score,
            message=solar.message,
        ),
        InquiryCheck(
            id="tree-shade",
            title="Tree Shade Pressure",
            dataset="OpenStreetMap vegetation",
            datasetDescription=(
                "OpenStreetMap vegetation features: trees, woods, forests, and parks."
            ),
            methodology=(
                "Builds a weighted vegetation pressure index per selected home inside cluster radius."
            ),
            interpretation=(
                "Lower pressure is better. A near-zero value means little mapped vegetation obstruction."
            ),
            status=tree_cover.status,
            score=tree_cover.score,
            message=tree_cover.message,
        ),
        InquiryCheck(
            id="built-form",
            title="Built Form Suitability",
            dataset="OpenStreetMap buildings",
            datasetDescription=(
                "OpenStreetMap building footprints and building tags (including height/levels when present)."
            ),
            methodology=(
                "Scores residential-like share positively and penalizes very tall-block density."
            ),
            interpretation=(
                "Higher values generally indicate easier residential rooftop deployment conditions."
            ),
            status=built_form.status,
            score=built_form.score,
            message=built_form.message,
        ),
        InquiryCheck(
            id="orientation",
            title="Orientation Flexibility",
            dataset="OpenStreetMap highways geometry",
            datasetDescription=(
                "OpenStreetMap road segment geometry used as a proxy for local urban grid orientation."
            ),
            methodology=(
                "Computes street bearing diversity between east-west and north-south tendencies."
            ),
            interpretation=(
                "Higher diversity suggests more roof-orientation options across the cluster."
            ),
            status=orientation.status,
            score=orientation.score,
            message=orientation.message,
        ),
        InquiryCheck(
            id="cloud-cover",
            title="Weather Reliability Signal",
            dataset="Open-Meteo cloud cover",
            datasetDescription=(
                "Open-Meteo daily cloud cover averages for near-term forecast conditions."
            ),
            methodology=(
                "Converts seven-day mean cloud-cover percentage into a weather reliability score."
            ),
            interpretation=(
                "Lower cloud cover pushes this score up; it is a short-term signal, not annual climate."
            ),
            status=cloud_cover.status,
            score=cloud_cover.score,
            message=cloud_cover.message,
        ),
    ]

    weighted = (
        solar.score * 0.34
        + tree_cover.score * 0.2
        + built_form.score * 0.21
        + orientation.score * 0.15
        + cloud_cover.score * 0.1
    )
    overall = int(round(clamp(weighted, 0, 100)))
    used_fallback = any(
        "unavailable" in signal.message.lower()
        for signal in [tree_cover, built_form, orientation, cloud_cover]
    )

    return InquiryResponse(
        areaLabel=payload.areaLabel,
        overallScore=overall,
        verdict=build_verdict(overall),
        checks=checks,
        usedFallbackSignals=used_fallback,
    )

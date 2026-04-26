import json
from typing import Any
from urllib import error, parse, request

from pydantic import BaseModel


class SolarYieldResponse(BaseModel):
    annualYieldKwhPerKwp: int
    avgSunHoursPerDay: float
    usedFallback: bool
    source: str | None = None


PVGIS_FALLBACK_YIELD = 820
PVGIS_FALLBACK_SUN_HOURS = 2.25


def fetch_solar_yield(lat: float, lon: float) -> SolarYieldResponse:
    query_params = {
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "peakpower": "1",
        "loss": "14",
        "mountingplace": "building",
        "angle": "35",
        "aspect": "0",
        "outputformat": "json",
    }
    url = f"https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?{parse.urlencode(query_params)}"

    try:
        req = request.Request(url, headers={"User-Agent": "WeeGrid-HackBelfast/1.0"})
        with request.urlopen(req, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (error.HTTPError, error.URLError, TimeoutError, json.JSONDecodeError):
        return SolarYieldResponse(
            annualYieldKwhPerKwp=PVGIS_FALLBACK_YIELD,
            avgSunHoursPerDay=PVGIS_FALLBACK_SUN_HOURS,
            usedFallback=True,
        )

    if not isinstance(data, dict):
        return SolarYieldResponse(
            annualYieldKwhPerKwp=PVGIS_FALLBACK_YIELD,
            avgSunHoursPerDay=PVGIS_FALLBACK_SUN_HOURS,
            usedFallback=True,
        )

    outputs = data.get("outputs")
    if not isinstance(outputs, dict):
        return SolarYieldResponse(
            annualYieldKwhPerKwp=PVGIS_FALLBACK_YIELD,
            avgSunHoursPerDay=PVGIS_FALLBACK_SUN_HOURS,
            usedFallback=True,
        )

    monthly_container = outputs.get("monthly")
    if not isinstance(monthly_container, dict):
        return SolarYieldResponse(
            annualYieldKwhPerKwp=PVGIS_FALLBACK_YIELD,
            avgSunHoursPerDay=PVGIS_FALLBACK_SUN_HOURS,
            usedFallback=True,
        )

    monthly_data = monthly_container.get("fixed")
    if not isinstance(monthly_data, list) or len(monthly_data) == 0:
        return SolarYieldResponse(
            annualYieldKwhPerKwp=PVGIS_FALLBACK_YIELD,
            avgSunHoursPerDay=PVGIS_FALLBACK_SUN_HOURS,
            usedFallback=True,
        )

    annual_yield = 0.0
    total_sun_hours = 0.0
    for month in monthly_data:
        if isinstance(month, dict):
            annual_yield += float(month.get("E_m", 0))
            total_sun_hours += float(month.get("H_sun", 0))

    avg_sun_hours = (total_sun_hours / 12) if total_sun_hours > 0 else PVGIS_FALLBACK_SUN_HOURS

    return SolarYieldResponse(
        annualYieldKwhPerKwp=round(annual_yield),
        avgSunHoursPerDay=round(avg_sun_hours, 2),
        usedFallback=False,
        source="PVGIS",
    )

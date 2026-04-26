import json
from typing import Any
from urllib import error, parse, request

from pydantic import BaseModel


class AddressData(BaseModel):
    suburb: str | None = None
    neighbourhood: str | None = None
    city_district: str | None = None
    city: str | None = None
    town: str | None = None
    village: str | None = None


class GeocodeResponse(BaseModel):
    latitude: float
    longitude: float
    displayName: str
    address: AddressData


def fetch_postcode(postcode: str) -> GeocodeResponse:
    normalized = postcode.strip().upper().replace(" ", "")
    url = f"https://api.postcodes.io/postcodes/{parse.quote(normalized)}"

    try:
        req = request.Request(url, headers={"User-Agent": "WeeGrid-HackBelfast/1.0"})
        with request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (error.HTTPError, error.URLError, TimeoutError) as exc:
        if isinstance(exc, error.HTTPError) and exc.code == 404:
            raise ValueError("Postcode not found. Please check and try again.")
        raise RuntimeError("Postcode lookup service unavailable.")

    if not isinstance(data, dict):
        raise RuntimeError("Unexpected postcodes.io response format.")

    result = data.get("result")
    if not result or not isinstance(result, dict):
        raise ValueError("Postcode not found. Please check and try again.")

    lat = result.get("latitude")
    lon = result.get("longitude")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        raise RuntimeError("Missing or invalid coordinates in postcodes.io response.")

    location_parts = [
        result.get("postcode"),
        result.get("admin_ward"),
        result.get("admin_district"),
        result.get("admin_county"),
        result.get("country"),
    ]
    display_name = ", ".join(str(p) for p in location_parts if p)

    return GeocodeResponse(
        latitude=float(lat),
        longitude=float(lon),
        displayName=display_name,
        address=AddressData(
            suburb=result.get("admin_ward"),
            neighbourhood=result.get("parish"),
            city_district=result.get("admin_district"),
            city=result.get("admin_county"),
            town=result.get("admin_district"),
            village=result.get("admin_ward"),
        ),
    )

from fastapi import FastAPI, HTTPException
from .cluster import ClusterResponse, fetch_cluster
from .geocode import GeocodeResponse, fetch_postcode
from .inquiry import InquiryRequest, InquiryResponse, analyze_cluster
from .insights import InsightsRequest, InsightsResponse, generate_insights
from .scenario import (
    ScenarioRequest,
    ScenarioResponse,
    SmartScenarioRequest,
    calculate_scenario,
    calculate_smart_scenario,
)
from .solar import SolarYieldResponse, fetch_solar_yield

app = FastAPI(
    title="WeeGrid API",
    description="Backend scaffold for HackBelfast community energy co-op platform.",
    version="0.1.0",
)


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/scenario/calculate", response_model=ScenarioResponse)
def calculate_scenario_route(payload: ScenarioRequest) -> ScenarioResponse:
    return calculate_scenario(
        form=payload.form,
        selected_homes=payload.selectedHomes,
        area_label=payload.areaLabel,
    )


@app.post("/api/v1/scenario/calculate-smart", response_model=ScenarioResponse)
def calculate_smart_scenario_route(payload: SmartScenarioRequest) -> ScenarioResponse:
    return calculate_smart_scenario(payload)


@app.post("/api/v1/inquiry/analyze", response_model=InquiryResponse)
def inquiry_analyze_route(payload: InquiryRequest) -> InquiryResponse:
    return analyze_cluster(payload)


@app.post("/api/v1/insights/generate", response_model=InsightsResponse)
def insights_generate_route(payload: InsightsRequest) -> InsightsResponse:
    return generate_insights(payload)


@app.get("/api/v1/geocode", response_model=GeocodeResponse)
def geocode_route(postcode: str) -> GeocodeResponse:
    try:
        return fetch_postcode(postcode)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@app.get("/api/v1/solar-yield", response_model=SolarYieldResponse)
def solar_yield_route(lat: float, lon: float) -> SolarYieldResponse:
    return fetch_solar_yield(lat, lon)


@app.get("/api/v1/cluster", response_model=ClusterResponse)
def cluster_route(lat: float, lon: float, label: str = "Local neighbourhood") -> ClusterResponse:
    return fetch_cluster(lat, lon, label)

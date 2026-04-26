from typing import Literal

from pydantic import BaseModel

InsightCategory = Literal["solar", "carbon", "comparison", "community", "fun"]


class InsightsRequest(BaseModel):
    areaLabel: str
    solarYieldKwhPerKw: float
    avgSunHoursPerDay: float | None = None
    annualGenerationKwh: float | None = None
    annualSelfUsedKwh: float | None = None
    annualExportedKwh: float | None = None
    houseCount: int | None = None
    totalPanelsKw: float | None = None


class Insight(BaseModel):
    id: str
    category: InsightCategory
    glyph: str
    title: str
    headline: str
    subtitle: str
    detail: str
    source: str


class InsightsResponse(BaseModel):
    areaLabel: str
    insights: list[Insight]


REFERENCE_CITIES: list[dict[str, float | str]] = [
    {"name": "Reykjavik", "yield": 700},
    {"name": "Stockholm", "yield": 780},
    {"name": "Belfast", "yield": 820},
    {"name": "London", "yield": 870},
    {"name": "Berlin", "yield": 940},
    {"name": "Paris", "yield": 1050},
    {"name": "Marseille", "yield": 1300},
    {"name": "Madrid", "yield": 1500},
]

UK_GRID_CO2_KG_PER_KWH = 0.21
UK_AVG_HOUSEHOLD_KWH = 3500
TREE_CO2_KG_PER_YEAR = 25
CAR_AVG_CO2_KG_PER_YEAR = 4600
LONDON_NEWYORK_FLIGHT_KG = 990
PHONE_CHARGE_KWH = 0.012
KETTLE_BOIL_KWH = 0.11
TENNIS_COURT_M2 = 261
PANEL_KW = 0.43
ROOF_M2_PER_KWP = 6.5


def _find_solar_personality(yield_value: float) -> dict[str, str]:
    sorted_refs = sorted(REFERENCE_CITIES, key=lambda c: float(c["yield"]))
    if yield_value <= float(sorted_refs[0]["yield"]):
        first = sorted_refs[0]
        return {
            "city": str(first["name"]),
            "narrative": (
                f"Your area's PVGIS yield is similar to {first['name']}'s northern climate."
            ),
        }
    if yield_value >= float(sorted_refs[-1]["yield"]):
        last = sorted_refs[-1]
        return {
            "city": str(last["name"]),
            "narrative": f"Your area generates as well as {last['name']} - rare for the UK!",
        }
    for lower, upper in zip(sorted_refs, sorted_refs[1:]):
        lower_value = float(lower["yield"])
        upper_value = float(upper["yield"])
        if lower_value <= yield_value <= upper_value:
            closer = lower if abs(yield_value - lower_value) <= abs(yield_value - upper_value) else upper
            return {
                "city": str(closer["name"]),
                "narrative": (
                    f"Your area's solar output sits between {lower['name']} "
                    f"({int(lower_value)} kWh/kWp) and {upper['name']} ({int(upper_value)} kWh/kWp), "
                    f"closest to {closer['name']}."
                ),
            }
    return {"city": "Belfast", "narrative": ""}


def _uk_percentile(yield_value: float) -> int:
    if yield_value >= 980:
        return 95
    if yield_value >= 920:
        return 85
    if yield_value >= 880:
        return 70
    if yield_value >= 840:
        return 55
    if yield_value >= 800:
        return 38
    if yield_value >= 760:
        return 22
    return 10


def generate_insights(payload: InsightsRequest) -> InsightsResponse:
    insights: list[Insight] = []
    yield_value = payload.solarYieldKwhPerKw

    personality = _find_solar_personality(yield_value)
    insights.append(
        Insight(
            id="solar-personality",
            category="comparison",
            glyph="◐",
            title="Solar climate twin",
            headline=f"Like {personality['city']}",
            subtitle=(
                f"Your {round(yield_value)} kWh/kWp/year matches "
                f"{personality['city']}'s solar climate"
            ),
            detail=personality["narrative"],
            source="PVGIS yield + reference cities",
        )
    )

    percentile = _uk_percentile(yield_value)
    insights.append(
        Insight(
            id="uk-tier",
            category="comparison",
            glyph="↑",
            title="UK solar tier",
            headline=f"Top {max(1, 100 - percentile)}% of UK locations",
            subtitle=f"Approx UK percentile rank: {percentile}",
            detail=(
                f"Your {round(yield_value)} kWh/kWp annual yield places this area ahead of "
                f"roughly {percentile}% of UK locations on PVGIS data."
            ),
            source="PVGIS + UK reference distribution (approx.)",
        )
    )

    if payload.avgSunHoursPerDay is not None:
        sun_hours = payload.avgSunHoursPerDay
        per_panel_daily_kwh = (PANEL_KW * yield_value) / 365
        kettle_boils = per_panel_daily_kwh / KETTLE_BOIL_KWH
        phone_charges = per_panel_daily_kwh / PHONE_CHARGE_KWH
        insights.append(
            Insight(
                id="daily-rhythm",
                category="solar",
                glyph="☀",
                title="A day in your panel's life",
                headline=f"~{sun_hours:.1f}h of usable sun/day",
                subtitle=f"One panel makes ~{per_panel_daily_kwh:.2f} kWh per day",
                detail=(
                    f"That is about {round(kettle_boils)} kettle boils OR "
                    f"{round(phone_charges)} full phone charges - per panel, every day, "
                    "averaged across the year."
                ),
                source="PVGIS sun hours + standard panel rating",
            )
        )

    if payload.annualGenerationKwh is not None:
        gen = payload.annualGenerationKwh
        co2_saved_kg = gen * UK_GRID_CO2_KG_PER_KWH
        co2_saved_t = co2_saved_kg / 1000
        cars_off = co2_saved_kg / CAR_AVG_CO2_KG_PER_YEAR
        trees = co2_saved_kg / TREE_CO2_KG_PER_YEAR
        flights = co2_saved_kg / LONDON_NEWYORK_FLIGHT_KG
        insights.append(
            Insight(
                id="carbon-impact",
                category="carbon",
                glyph="◇",
                title="Carbon avoided each year",
                headline=f"{co2_saved_t:.1f} tonnes CO2/year",
                subtitle=f"From {round(gen):,} kWh of clean generation",
                detail=(
                    f"Equivalent to about {cars_off:.1f} average cars taken off the road, "
                    f"{round(trees)} mature trees of yearly absorption, "
                    f"or {flights:.1f} return London-New York flights avoided."
                ),
                source="UK grid intensity (DESNZ avg ~0.21 kg/kWh)",
            )
        )

    if payload.annualGenerationKwh is not None and payload.houseCount:
        homes_powered = payload.annualGenerationKwh / UK_AVG_HOUSEHOLD_KWH
        insights.append(
            Insight(
                id="community-impact",
                category="community",
                glyph="⌂",
                title="Equivalent UK homes powered",
                headline=f"{homes_powered:.1f} homes",
                subtitle=f"From a {payload.houseCount}-home cluster",
                detail=(
                    f"At UK average household electricity use ({UK_AVG_HOUSEHOLD_KWH:,} kWh/year), "
                    f"your cluster generates the energy equivalent of fully powering "
                    f"{homes_powered:.1f} typical UK homes."
                ),
                source="UK BEIS average household electricity use",
            )
        )

    if payload.totalPanelsKw is not None and payload.totalPanelsKw > 0:
        roof_m2 = payload.totalPanelsKw * ROOF_M2_PER_KWP
        tennis = roof_m2 / TENNIS_COURT_M2
        cluster_label = (
            f"{payload.houseCount} rooftops" if payload.houseCount else "the cluster's rooftops"
        )
        insights.append(
            Insight(
                id="roof-area",
                category="fun",
                glyph="▢",
                title="Roof real estate in play",
                headline=f"{round(roof_m2):,} m² of panels",
                subtitle=f"Across {cluster_label}",
                detail=(
                    f"If laid flat, your shared array would cover roughly {tennis:.1f} "
                    "tennis courts of solar - quietly tucked onto rooftops you already have."
                ),
                source="Industry avg ~6.5 m²/kWp",
            )
        )

    if payload.annualSelfUsedKwh is not None and payload.annualSelfUsedKwh > 0:
        tea_count = payload.annualSelfUsedKwh / KETTLE_BOIL_KWH
        insights.append(
            Insight(
                id="self-used-tea",
                category="fun",
                glyph="◷",
                title="Self-used energy, in cuppas",
                headline=f"{round(tea_count):,} kettle boils/year",
                subtitle=f"From {round(payload.annualSelfUsedKwh):,} kWh self-used per year",
                detail=(
                    "That is the cluster's self-consumed electricity, expressed in a very "
                    "Belfast unit of impact: full kettle boils."
                ),
                source="UK kettle ~0.11 kWh per boil",
            )
        )

    return InsightsResponse(areaLabel=payload.areaLabel, insights=insights)

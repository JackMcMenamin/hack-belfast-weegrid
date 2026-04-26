import unittest
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.scenario import (
    SmartScenarioRequest,
    build_smart_assumptions,
    calculate_scenario,
    calculate_smart_scenario,
)


class ScenarioModelTests(unittest.TestCase):
    def test_build_smart_assumptions_bounds_and_defaults(self) -> None:
        assumptions = build_smart_assumptions(house_count=12, solar_yield_kwh_per_kw=None)

        self.assertEqual(assumptions.investmentPerHome, 886)
        self.assertEqual(assumptions.governmentSupportAmount, 80000)
        self.assertFalse(assumptions.includeBattery)
        self.assertEqual(assumptions.solarYieldKwhPerKw, 820)

    def test_calculate_scenario_returns_expected_shape(self) -> None:
        assumptions = build_smart_assumptions(house_count=80, solar_yield_kwh_per_kw=900)
        result = calculate_scenario(
            form=assumptions,
            selected_homes=80,
            area_label="Test Area",
        )

        self.assertEqual(result.houseCount, 80)
        self.assertEqual(result.areaLabel, "Test Area")
        self.assertEqual(len(result.yearlySavingsChart), 16)
        self.assertEqual(result.yearlySavingsChart[0].year, "Y0")
        self.assertGreater(result.totalPanelsKw, 0)
        self.assertEqual(result.sunlightEstimateHours, 900)
        self.assertIsNotNone(result.assumptionsUsed)

    def test_calculate_smart_scenario_uses_payload_inputs(self) -> None:
        payload = SmartScenarioRequest(
            selectedHomes=30,
            areaLabel="Smart Area",
            solarYieldKwhPerKw=875,
        )
        result = calculate_smart_scenario(payload)

        self.assertEqual(result.houseCount, 30)
        self.assertEqual(result.areaLabel, "Smart Area")
        self.assertEqual(result.sunlightEstimateHours, 875)
        self.assertIsNotNone(result.assumptionsUsed)
        self.assertEqual(result.assumptionsUsed.solarYieldKwhPerKw, 875)


if __name__ == "__main__":
    unittest.main()

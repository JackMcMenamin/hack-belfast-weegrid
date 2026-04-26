"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { convexHull, expandHull } from "@/lib/geometry";

const POSTCODE_PATTERN = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const StreetOverviewMap = dynamic(
  () => import("@/components/street-overview-map"),
  { ssr: false },
);

type GeocodeData = {
  latitude: number;
  longitude: number;
  displayName: string;
  address: {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    village?: string;
    town?: string;
    city_district?: string;
    city?: string;
  };
};

type ClusterBuilding = {
  lat: number;
  lon: number;
  residential: boolean;
};

type ClusterData = {
  center: { latitude: number; longitude: number };
  areaLabel: string;
  areaType: "village" | "neighbourhood" | "street" | "district";
  totalBuildingsDetected: number;
  residentialDetected: number;
  buildings: ClusterBuilding[];
  defaultSelectedHomes: number;
  recommendedRangeMin: number;
  recommendedRangeMax: number;
  hull: { lat: number; lon: number }[];
  searchRadiusMeters: number;
  usedFallback: boolean;
};

type SolarYieldData = {
  annualYieldKwhPerKwp: number;
  avgSunHoursPerDay: number;
  usedFallback: boolean;
  source?: string;
};

type YearlySavingData = {
  year: string;
  initialInvestment: number;
  loanRepayment: number;
  pocketSaving: number;
  cumulativeNet: number;
};

type CalculatorResult = {
  houseCount: number;
  areaLabel: string;
  memberInvestmentTotal: number;
  governmentLoanAmount: number;
  targetInstallCost: number;
  totalPanelsKw: number;
  estimatedPanelCount: number;
  annualGenerationKwh: number;
  annualSelfUsedKwh: number;
  annualExportedKwh: number;
  totalCoopFund: number;
  totalInstallCost: number;
  fundingGap: number;
  grossAnnualStreetSaving: number;
  projectedAnnualStreetSavingYear15: number;
  annualSavingPerHomeDuringLoan: number;
  loanClearedYear: number;
  annualSavingPerHomeAfterLoan: number;
  memberPaybackMonths: number | null;
  total15YearPerHome: number;
  roiPercent15Year: number;
  yearlySavingsChart: YearlySavingData[];
  sunlightEstimateHours: number;
  assumptionsSummary: string;
  cappedByFunding: boolean;
  deploymentSharePercent: number;
  annualEnergyPriceRisePercent: number;
};

type InquiryCheckStatus = "great" | "good" | "mixed" | "rough";

type InquiryCheck = {
  id: string;
  title: string;
  dataset: string;
  datasetDescription: string;
  methodology: string;
  interpretation: string;
  status: InquiryCheckStatus;
  score: number;
  message: string;
};

type InquiryResult = {
  areaLabel: string;
  overallScore: number;
  verdict: string;
  checks: InquiryCheck[];
  usedFallbackSignals: boolean;
};

type InsightCategory = "solar" | "carbon" | "comparison" | "community" | "fun";

type Insight = {
  id: string;
  category: InsightCategory;
  glyph: string;
  title: string;
  headline: string;
  subtitle: string;
  detail: string;
  source: string;
};

type InsightsResult = {
  areaLabel: string;
  insights: Insight[];
};

const PRELIMINARY_CHECKS: Array<{
  id: string;
  title: string;
  dataset: string;
}> = [
  { id: "solar-resource", title: "Solar Resource", dataset: "PVGIS" },
  {
    id: "tree-shade",
    title: "Tree Shade Pressure",
    dataset: "OpenStreetMap vegetation",
  },
  {
    id: "built-form",
    title: "Built Form Suitability",
    dataset: "OpenStreetMap buildings",
  },
  {
    id: "orientation",
    title: "Orientation Flexibility",
    dataset: "OpenStreetMap highways geometry",
  },
  {
    id: "cloud-cover",
    title: "Weather Reliability Signal",
    dataset: "Open-Meteo cloud cover",
  },
];

const MIN_HOUSES = 20;

function pounds(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Home() {
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [geocodeData, setGeocodeData] = useState<GeocodeData | null>(null);
  const [clusterData, setClusterData] = useState<ClusterData | null>(null);
  const [solarYieldData, setSolarYieldData] = useState<SolarYieldData | null>(
    null,
  );
  const [selectedHomes, setSelectedHomes] = useState(100);
  const [manualIncludes, setManualIncludes] = useState<Set<number>>(
    () => new Set(),
  );
  const [manualExcludes, setManualExcludes] = useState<Set<number>>(
    () => new Set(),
  );
  const [calculatorResult, setCalculatorResult] = useState<CalculatorResult | null>(
    null,
  );
  const [isCalculating, setIsCalculating] = useState(false);
  const [isInquiring, setIsInquiring] = useState(false);
  const [inquirySubmitted, setInquirySubmitted] = useState(false);
  const [inquiryError, setInquiryError] = useState("");
  const [inquiryResult, setInquiryResult] = useState<InquiryResult | null>(null);
  const [revealedChecks, setRevealedChecks] = useState(0);
  const [insightsResult, setInsightsResult] = useState<InsightsResult | null>(
    null,
  );
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [expandedDatasetInfo, setExpandedDatasetInfo] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["main"]),
  );
  const streetOverviewRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const toggleDatasetInfo = (checkId: string) => {
    setExpandedDatasetInfo((previous) => {
      const next = new Set(previous);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return next;
    });
  };

  const sliderMin = clusterData
    ? Math.min(clusterData.recommendedRangeMin, clusterData.buildings.length)
    : MIN_HOUSES;
  const sliderMax = clusterData
    ? Math.max(sliderMin, clusterData.buildings.length)
    : 200;

  const baseSelectedHomes = clusterData
    ? Math.min(sliderMax, Math.max(sliderMin, selectedHomes))
    : selectedHomes;

  const selectedIndices = useMemo(() => {
    if (!clusterData) return new Set<number>();
    const set = new Set<number>();
    for (let i = 0; i < baseSelectedHomes; i += 1) {
      if (!manualExcludes.has(i)) {
        set.add(i);
      }
    }
    for (const index of manualIncludes) {
      set.add(index);
    }
    return set;
  }, [clusterData, baseSelectedHomes, manualIncludes, manualExcludes]);

  const finalSelectedCount = selectedIndices.size;

  const buildingMarkers = useMemo(() => {
    if (!clusterData) return [];
    return clusterData.buildings.map((building, index) => ({
      index,
      lat: building.lat,
      lon: building.lon,
      selected: selectedIndices.has(index),
    }));
  }, [clusterData, selectedIndices]);

  const selectedHull = useMemo(() => {
    if (!clusterData) return [] as [number, number][];
    const selectedBuildings = clusterData.buildings.filter((_, index) =>
      selectedIndices.has(index),
    );
    if (selectedBuildings.length < 3) {
      return (
        clusterData.hull.map(
          (point) => [point.lat, point.lon] as [number, number],
        ) ?? []
      );
    }
    const points = selectedBuildings.map((building) => ({
      lat: building.lat,
      lon: building.lon,
    }));
    const hull = expandHull(convexHull(points), 25);
    return hull.map((point) => [point.lat, point.lon] as [number, number]);
  }, [clusterData, selectedIndices]);

  const handleToggleBuilding = (index: number) => {
    const isCurrentlySelected = selectedIndices.has(index);
    const isInsideBaseRing = index < baseSelectedHomes;

    if (isCurrentlySelected) {
      if (isInsideBaseRing) {
        setManualExcludes((previous) => {
          const next = new Set(previous);
          next.add(index);
          return next;
        });
      }
      setManualIncludes((previous) => {
        if (!previous.has(index)) return previous;
        const next = new Set(previous);
        next.delete(index);
        return next;
      });
    } else {
      if (isInsideBaseRing) {
        setManualExcludes((previous) => {
          if (!previous.has(index)) return previous;
          const next = new Set(previous);
          next.delete(index);
          return next;
        });
      } else {
        setManualIncludes((previous) => {
          const next = new Set(previous);
          next.add(index);
          return next;
        });
      }
    }
  };

  const handleResetSelection = () => {
    setManualIncludes(new Set());
    setManualExcludes(new Set());
  };

  const hasManualOverrides =
    manualIncludes.size > 0 || manualExcludes.size > 0;

  useEffect(() => {
    if (!inquiryResult) return;
    const interval = window.setInterval(() => {
      setRevealedChecks((current) => {
        if (current >= inquiryResult.checks.length) {
          window.clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, 700);
    return () => window.clearInterval(interval);
  }, [inquiryResult]);

  useEffect(() => {
    if (!calculatorResult || !solarYieldData) return;
    const controller = new AbortController();

    const loadInsights = async () => {
      setIsLoadingInsights(true);
      try {
        const response = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            areaLabel: calculatorResult.areaLabel,
            solarYieldKwhPerKw: solarYieldData.annualYieldKwhPerKwp,
            avgSunHoursPerDay: solarYieldData.avgSunHoursPerDay,
            annualGenerationKwh: calculatorResult.annualGenerationKwh,
            annualSelfUsedKwh: calculatorResult.annualSelfUsedKwh,
            annualExportedKwh: calculatorResult.annualExportedKwh,
            houseCount: calculatorResult.houseCount,
            totalPanelsKw: calculatorResult.totalPanelsKw,
          }),
        });
        const payload = (await response.json()) as
          | InsightsResult
          | { error?: string };
        if (response.ok && "insights" in payload) {
          setInsightsResult(payload);
        }
      } catch {
        // silent fail; insights are non-critical
      } finally {
        setIsLoadingInsights(false);
      }
    };

    loadInsights();
    return () => controller.abort();
  }, [calculatorResult, solarYieldData]);

  const handleContinueToResults = async () => {
    if (!clusterData) return;
    setError("");
    setIsCalculating(true);

    try {
      const response = await fetch("/api/scenario-smart", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedHomes: finalSelectedCount,
          areaLabel: clusterData.areaLabel,
          solarYieldKwhPerKw: solarYieldData?.annualYieldKwhPerKwp,
        }),
      });

      const payload = (await response.json()) as
        | CalculatorResult
        | { error?: string };

      if (!response.ok || !("houseCount" in payload)) {
        throw new Error(
          ("error" in payload && payload.error) ||
            "We could not calculate this scenario right now.",
        );
      }

      setCalculatorResult(payload);
      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (calculateError) {
      setError(
        calculateError instanceof Error
          ? calculateError.message
          : "Scenario calculation failed.",
      );
    } finally {
      setIsCalculating(false);
    }
  };

  const handleInquiryNow = async () => {
    if (!clusterData || !geocodeData) return;
    setInquirySubmitted(false);
    setInquiryError("");
    setIsInquiring(true);
    setRevealedChecks(0);
    setExpandedDatasetInfo(new Set());
    setInquiryResult(null);

    try {
      const selectedBuildings = buildingMarkers
        .filter((building) => building.selected)
        .map((building) => ({ lat: building.lat, lon: building.lon }));

      const response = await fetch("/api/inquiry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          areaLabel: clusterData.areaLabel,
          centerLat: geocodeData.latitude,
          centerLon: geocodeData.longitude,
          selectedHomes: finalSelectedCount,
          solarYieldKwhPerKw: solarYieldData?.annualYieldKwhPerKwp,
          selectedBuildings,
          hull: selectedHull.map(([lat, lon]) => ({ lat, lon })),
        }),
      });

      const payload = (await response.json()) as InquiryResult | { error?: string };
      if (!response.ok || !("overallScore" in payload)) {
        throw new Error(
          ("error" in payload && payload.error) ||
            "We could not run the inquiry checks right now.",
        );
      }

      setInquiryResult(payload);
    } catch (inquiryErr) {
      setInquiryError(
        inquiryErr instanceof Error
          ? inquiryErr.message
          : "Inquiry analysis failed.",
      );
    } finally {
      setIsInquiring(false);
    }
  };


  const handleSubmitInquiry = () => {
    setInquirySubmitted(true);
  };

  const statusStyles: Record<InquiryCheckStatus, string> = {
    great: "border-emerald-500/40 bg-emerald-900/20 text-emerald-100",
    good: "border-green-500/35 bg-green-900/20 text-green-100",
    mixed: "border-amber-500/35 bg-amber-900/20 text-amber-100",
    rough: "border-rose-500/40 bg-rose-900/20 text-rose-100",
  };

  const statusBadgeText: Record<InquiryCheckStatus, string> = {
    great: "Great",
    good: "Good",
    mixed: "Mixed",
    rough: "Rough",
  };

  const inquiryRows = inquiryResult
    ? inquiryResult.checks
    : PRELIMINARY_CHECKS.map((check) => ({
        ...check,
        status: "mixed" as InquiryCheckStatus,
        score: 0,
        message: "",
        datasetDescription: "",
        methodology: "",
        interpretation: "",
      }));
  const inquiryComplete =
    Boolean(inquiryResult) && revealedChecks >= inquiryRows.length;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = postcode.trim().toUpperCase();

    if (!trimmed) {
      setError("Enter a postcode to continue.");
      return;
    }

    if (!POSTCODE_PATTERN.test(trimmed)) {
      setError("Enter a valid UK postcode, for example BT1 5GS.");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/geocode?postcode=${encodeURIComponent(trimmed)}`,
      );
      const payload = (await response.json()) as
        | GeocodeData
        | { error?: string };

      if (!response.ok || !("latitude" in payload)) {
        throw new Error(
          ("error" in payload && payload.error) ||
            "We could not locate that postcode yet.",
        );
      }

      setGeocodeData(payload);

      const fallbackLabel =
        payload.address.suburb ??
        payload.address.neighbourhood ??
        payload.address.village ??
        payload.address.town ??
        payload.address.city_district ??
        `Postcode area ${trimmed.slice(0, -3).trim()}`;

      const [clusterResponse, solarResponse] = await Promise.all([
        fetch(
          `/api/cluster?lat=${payload.latitude}&lon=${payload.longitude}&label=${encodeURIComponent(
            fallbackLabel,
          )}`,
        ),
        fetch(
          `/api/solar-yield?lat=${payload.latitude}&lon=${payload.longitude}`,
        ),
      ]);

      const clusterPayload = (await clusterResponse.json()) as
        | ClusterData
        | { error?: string };

      if (!clusterResponse.ok || !("buildings" in clusterPayload)) {
        throw new Error(
          ("error" in clusterPayload && clusterPayload.error) ||
            "We could not analyse that area yet. Please try again in a moment.",
        );
      }

      const solarPayload = (await solarResponse.json()) as
        | SolarYieldData
        | { error?: string };

      if (solarResponse.ok && "annualYieldKwhPerKwp" in solarPayload) {
        setSolarYieldData(solarPayload);
      } else {
        setSolarYieldData({
          annualYieldKwhPerKwp: 820,
          avgSunHoursPerDay: 2.25,
          usedFallback: true,
        });
      }

      setClusterData(clusterPayload);
      setSelectedHomes(clusterPayload.defaultSelectedHomes);
      setManualIncludes(new Set());
      setManualExcludes(new Set());

      requestAnimationFrame(() => {
        streetOverviewRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong while finding your location.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="brand-page">
      <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16 text-white">
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        >
          <source src="/bg.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-emerald-950/65 to-black/70" />
        <div className="pointer-events-none absolute -top-48 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-green-400/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />

        <section className="hero-card relative mx-auto w-full max-w-3xl rounded-2xl p-6 md:p-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-green-600">
              WeeGrid | Belfast 2036
            </p>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-gray-900 md:text-4xl">
              What if your neighbourhood created its own power?
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              Pool investment, unlock 0% community energy finance, and own local solar together.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="mt-6 flex flex-col gap-2 md:flex-row md:items-start"
          >
            <div className="flex-1">
              <label htmlFor="postcode" className="sr-only">
                Postcode
              </label>
              <input
                id="postcode"
                name="postcode"
                autoComplete="postal-code"
                value={postcode}
                onChange={(event) => setPostcode(event.target.value)}
                placeholder="Enter postcode (e.g. BT7 1NN)"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 outline-none ring-green-500 placeholder:text-gray-400 focus:ring-2"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex h-[50px] items-center justify-center rounded-xl bg-green-600 px-8 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-70 md:h-[50px]"
            >
              {isLoading ? "..." : "GO"}
            </button>
          </form>
          {error ? (
            <p className="mt-2 text-center text-sm text-rose-600" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      </section>

      <div className="dark-bg-wrapper">
        <section
          id="street-overview"
          ref={streetOverviewRef}
          className="step2-section px-6 pb-20 pt-12 text-white md:pt-16"
        >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">
              Step 2 | Smart Cluster
            </p>
            <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">
              Your co-op cluster
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-emerald-100/85">
              Auto-detected from your postcode. Adjust the slider to include more or fewer homes.
            </p>
          </div>

          <div className="brand-panel rounded-3xl p-4 md:p-5">
            {geocodeData && clusterData ? (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="rounded-xl border border-white/20 bg-black/25 p-4 md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Homes in cluster
                      </p>
                      {hasManualOverrides ? (
                        <button
                          type="button"
                          onClick={handleResetSelection}
                          className="rounded-md border border-white/20 px-2 py-1 text-[11px] uppercase tracking-wide text-emerald-100/80 transition hover:border-emerald-300/50 hover:text-emerald-50"
                        >
                          Reset to auto
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        type="range"
                        min={sliderMin}
                        max={sliderMax}
                        step={1}
                        value={baseSelectedHomes}
                        onChange={(event) =>
                          setSelectedHomes(
                            Math.min(
                              sliderMax,
                              Math.max(sliderMin, Number(event.target.value)),
                            ),
                          )
                        }
                        className="w-full accent-green-400"
                      />
                      <span className="min-w-10 text-right text-sm font-semibold">
                        {finalSelectedCount}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-emerald-100/70">
                      {clusterData.totalBuildingsDetected} buildings detected. Recommended: {clusterData.recommendedRangeMin}-{clusterData.recommendedRangeMax} homes.
                    </p>
                  </label>
                </div>

                <StreetOverviewMap
                  latitude={geocodeData.latitude}
                  longitude={geocodeData.longitude}
                  hull={selectedHull}
                  buildings={buildingMarkers}
                  areaLabel={clusterData.areaLabel}
                  reframeKey={`${geocodeData.latitude.toFixed(5)},${geocodeData.longitude.toFixed(5)}`}
                  onToggleBuilding={handleToggleBuilding}
                />

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                      Selected postcode
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {postcode.trim().toUpperCase()}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                      Detected area
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {clusterData.areaLabel}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                      Cluster type
                    </p>
                    <p className="mt-1 text-lg font-semibold capitalize">
                      {clusterData.areaType}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                      Homes selected
                    </p>
                    <p className="mt-1 text-lg font-semibold">
                      {finalSelectedCount} / {clusterData.buildings.length}
                    </p>
                    {hasManualOverrides ? (
                      <p className="mt-1 text-[11px] text-emerald-100/60">
                        +{manualIncludes.size} added, -{manualExcludes.size}{" "}
                        removed
                      </p>
                    ) : null}
                  </div>
                </div>

                {solarYieldData ? (
                  <div
                    className={`relative overflow-hidden rounded-xl border p-4 ${
                      solarYieldData.usedFallback
                        ? "border-amber-500/40 bg-amber-950/20"
                        : "border-amber-400/50 bg-gradient-to-br from-amber-950/30 via-yellow-950/20 to-emerald-950/20"
                    }`}
                  >
                    <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-amber-400/10 blur-2xl" />
                    <div className="absolute -right-4 -top-4 text-6xl opacity-20">☀️</div>
                    <p className="relative text-xs font-semibold uppercase tracking-wide text-amber-200">
                      {solarYieldData.usedFallback ? "⚠ " : "☀ "}Solar yield
                      data{" "}
                      {solarYieldData.usedFallback ? "fallback" : "loaded"}
                    </p>
                    <div className="mt-2 grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="text-xs text-emerald-100/70">
                          Annual yield per kWp
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          {solarYieldData.annualYieldKwhPerKwp} kWh
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-emerald-100/70">
                          Avg sun hours/day
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          {solarYieldData.avgSunHoursPerDay} h
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-emerald-100/70">Data source</p>
                        <p className="mt-1 text-base font-semibold">
                          {solarYieldData.usedFallback
                            ? "NI average"
                            : solarYieldData.source ?? "PVGIS"}
                        </p>
                      </div>
                    </div>
                    {!solarYieldData.usedFallback ? (
                      <p className="mt-2 text-xs text-emerald-100/70">
                        Real solar irradiance data from European Commission
                        PVGIS API for {geocodeData.displayName}.
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-amber-100/70">
                        PVGIS API unavailable, using Northern Ireland regional
                        average.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-dashed border-white/25 bg-black/15 px-6 text-center text-emerald-50/70">
                Enter a Belfast postcode above to load the interactive map and
                smart-suggested co-op cluster.
              </div>
            )}
          </div>
        </div>
      </section>

      {geocodeData && clusterData ? (
        <div className="step2-section px-6 pb-12 pt-4">
          <div className="relative mx-auto flex w-full max-w-6xl items-center justify-center">
            <button
              type="button"
              onClick={handleContinueToResults}
              disabled={isCalculating}
              className="rounded-xl bg-green-400 px-6 py-3 text-sm font-bold text-emerald-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isCalculating
                ? "Calculating scenario..."
                : "Continue to calculator"}
            </button>
          </div>
        </div>
      ) : null}

      <section
        id="results"
        ref={resultsRef}
        className="step3-section px-6 pb-20 pt-12 text-white md:pt-16"
      >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
            {calculatorResult ? (
            <section className="brand-panel rounded-3xl p-5 md:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-300">
                Step 3 | Projected Savings & Returns
              </p>
              <h3 className="mt-2 text-2xl font-bold md:text-3xl">
                You could save{" "}
                {pounds(calculatorResult.annualSavingPerHomeAfterLoan)} per
                year per household after year{" "}
                {calculatorResult.loanClearedYear || 1}
              </h3>
              <p className="mt-2 text-emerald-100/75">
                Area modeled: {calculatorResult.areaLabel} ({calculatorResult.houseCount} homes).
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                    Member payback period
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {calculatorResult.memberPaybackMonths
                      ? `~${calculatorResult.memberPaybackMonths} months`
                      : "Beyond 15-year window"}
                  </p>
                  <p className="mt-1 text-xs text-emerald-100/60">
                    Time until your £
                    {Math.round(
                      calculatorResult.memberInvestmentTotal /
                        calculatorResult.houseCount,
                    )}{" "}
                    is fully returned
                  </p>
                </div>
                <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                    Co-op loan cleared
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    Year {calculatorResult.loanClearedYear || "N/A"}
                  </p>
                  <p className="mt-1 text-xs text-emerald-100/60">
                    {pounds(calculatorResult.governmentLoanAmount)} paid from
                    collective savings
                  </p>
                </div>
                <div className="rounded-xl border border-white/20 bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                    15-year total return
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {pounds(
                      calculatorResult.total15YearPerHome +
                        calculatorResult.memberInvestmentTotal /
                          calculatorResult.houseCount,
                    )}
                  </p>
                  <p className="mt-1 text-xs text-emerald-100/60">
                    per household (
                    {calculatorResult.roiPercent15Year.toFixed(0)}% ROI)
                  </p>
                </div>
              </div>

              {insightsResult && insightsResult.insights.length > 0 ? (
                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => toggleSection("impact-stories")}
                    className="flex w-full items-center justify-between rounded-xl border border-white/20 bg-black/15 p-4 text-left transition hover:border-emerald-400/40"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-green-300">
                        Local Impact Stories
                      </p>
                      <h4 className="mt-1 text-lg font-bold text-emerald-50">
                        What this actually means for {insightsResult.areaLabel}
                      </h4>
                    </div>
                    <span className="text-2xl text-emerald-300">
                      {expandedSections.has("impact-stories") ? "▼" : "▶"}
                    </span>
                  </button>
                  {expandedSections.has("impact-stories") ? (
                  <div className="mt-3">
                  <div className="flex items-end justify-between gap-3">
                    {isLoadingInsights ? (
                      <span className="text-xs text-emerald-100/60">
                        Refreshing...
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {insightsResult.insights.map((insight, index) => {
                      const tones: Record<InsightCategory, string> = {
                        solar:
                          "border-amber-400/35 bg-gradient-to-br from-amber-900/35 via-amber-950/20 to-emerald-950/40",
                        carbon:
                          "border-emerald-400/35 bg-gradient-to-br from-emerald-900/40 via-emerald-950/30 to-black/30",
                        comparison:
                          "border-sky-400/35 bg-gradient-to-br from-sky-900/35 via-emerald-950/30 to-black/40",
                        community:
                          "border-violet-400/35 bg-gradient-to-br from-violet-900/35 via-emerald-950/25 to-black/40",
                        fun:
                          "border-rose-400/35 bg-gradient-to-br from-rose-900/35 via-emerald-950/25 to-black/40",
                      };
                      const glyphTones: Record<InsightCategory, string> = {
                        solar: "text-amber-200 border-amber-300/40",
                        carbon: "text-emerald-200 border-emerald-300/40",
                        comparison: "text-sky-200 border-sky-300/40",
                        community: "text-violet-200 border-violet-300/40",
                        fun: "text-rose-200 border-rose-300/40",
                      };
                      const featured =
                        insight.id === "solar-personality" ||
                        insight.id === "carbon-impact";
                      return (
                        <div
                          key={insight.id}
                          className={`rounded-2xl border p-4 ${tones[insight.category]} ${
                            featured ? "md:col-span-2 lg:col-span-2" : ""
                          }`}
                          style={{ animationDelay: `${index * 60}ms` }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-full border bg-black/40 text-lg ${glyphTones[insight.category]}`}
                            >
                              {insight.glyph}
                            </div>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/60">
                              {insight.category}
                            </span>
                          </div>
                          <p className="mt-3 text-xs uppercase tracking-wide text-emerald-100/70">
                            {insight.title}
                          </p>
                          <p
                            className={`mt-1 font-extrabold text-emerald-50 ${
                              featured ? "text-3xl md:text-4xl" : "text-2xl"
                            }`}
                          >
                            {insight.headline}
                          </p>
                          <p className="mt-1 text-sm text-emerald-100/85">
                            {insight.subtitle}
                          </p>
                          <p className="mt-3 text-xs leading-5 text-emerald-100/75">
                            {insight.detail}
                          </p>
                          <p className="mt-3 text-[10px] uppercase tracking-wide text-emerald-100/45">
                            Source: {insight.source}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-7 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/20 bg-black/15 p-4">
                  <p className="mb-3 text-sm font-semibold text-emerald-100">
                    Your pocket: annual saving per household
                  </p>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={calculatorResult.yearlySavingsChart.slice(1)}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#14532d"
                        />
                        <XAxis dataKey="year" stroke="#d1fae5" />
                        <YAxis stroke="#d1fae5" />
                        <Tooltip
                          formatter={(value) => pounds(Number(value ?? 0))}
                          contentStyle={{
                            backgroundColor: "#052e16",
                            border: "1px solid #166534",
                            color: "#ecfdf5",
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="pocketSaving"
                          fill="#22c55e"
                          name="Net cash in your pocket each year"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSection("pocket-explainer")}
                    className="mt-3 flex w-full items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-left text-xs transition hover:border-emerald-400/50"
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-emerald-400/50 text-[10px] font-bold text-emerald-300">
                      i
                    </span>
                    <span className="font-semibold text-emerald-100">
                      {expandedSections.has("pocket-explainer")
                        ? "Hide"
                        : "Show"}{" "}
                      detailed breakdown
                    </span>
                  </button>
                  {expandedSections.has("pocket-explainer") ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-emerald-100/80">
                      <p className="mb-2 font-semibold text-emerald-50">
                        How the savings work:
                      </p>
                      <div className="space-y-2">
                        <p>
                          <span className="font-semibold text-emerald-200">
                            Without solar:
                          </span>{" "}
                          Average NI household pays ~£1,180/year for
                          electricity (4,200 kWh × £0.28/kWh).
                        </p>
                        <p>
                          <span className="font-semibold text-emerald-200">
                            With co-op solar:
                          </span>{" "}
                          Panels generate ~
                          {Math.round(
                            calculatorResult.annualGenerationKwh /
                              calculatorResult.houseCount,
                          ).toLocaleString()}{" "}
                          kWh/year per home. You self-consume ~
                          {Math.round(
                            calculatorResult.annualSelfUsedKwh /
                              calculatorResult.houseCount,
                          ).toLocaleString()}{" "}
                          kWh directly (worth ~
                          {pounds(
                            (calculatorResult.annualSelfUsedKwh /
                              calculatorResult.houseCount) *
                              0.28,
                          )}
                          ), and export the rest for revenue. Your new bill: ~
                          {pounds(
                            1180 -
                              (calculatorResult.annualSelfUsedKwh /
                                calculatorResult.houseCount) *
                                0.28,
                          )}
                          /year.
                        </p>
                        <p>
                          <span className="font-semibold text-emerald-200">
                            Years 1–{calculatorResult.loanClearedYear}:
                          </span>{" "}
                          The street&apos;s total bill savings (
                          {pounds(calculatorResult.grossAnnualStreetSaving)} in
                          year 1) are pooled. Most goes to clearing the{" "}
                          {pounds(calculatorResult.governmentLoanAmount)}{" "}
                          government loan. You still pocket{" "}
                          {pounds(
                            calculatorResult.annualSavingPerHomeDuringLoan,
                          )}
                          /year on average during this period.
                        </p>
                        <p>
                          <span className="font-semibold text-emerald-200">
                            Years {calculatorResult.loanClearedYear + 1}+:
                          </span>{" "}
                          Loan paid off. 100% of your ~
                          {pounds(
                            (calculatorResult.annualSelfUsedKwh /
                              calculatorResult.houseCount) *
                              0.28,
                          )}{" "}
                          annual bill reduction is yours to keep, growing to ~
                          {pounds(
                            calculatorResult.annualSavingPerHomeAfterLoan,
                          )}{" "}
                          by year 15 as prices rise.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-white/20 bg-black/15 p-4">
                  <p className="mb-3 text-sm font-semibold text-emerald-100">
                    Member investment payback timeline
                  </p>
                  <div className="space-y-4 py-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/20 text-xl font-bold text-orange-300">
                        £
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-emerald-50">
                          Year 0: You invest
                        </p>
                        <p className="text-xs text-emerald-100/70">
                          £
                          {Math.round(
                            calculatorResult.memberInvestmentTotal /
                              calculatorResult.houseCount,
                          )}{" "}
                          upfront to join the co-op
                        </p>
                      </div>
                    </div>
                    <div className="ml-6 h-8 w-px bg-gradient-to-b from-orange-400 to-green-400" />
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20 text-xl font-bold text-green-300">
                        ✓
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-emerald-50">
                          ~
                          {calculatorResult.memberPaybackMonths
                            ? Math.floor(
                                calculatorResult.memberPaybackMonths / 12,
                              )
                            : "X"}{" "}
                          years: Investment returned
                        </p>
                        <p className="text-xs text-emerald-100/70">
                          Your £
                          {Math.round(
                            calculatorResult.memberInvestmentTotal /
                              calculatorResult.houseCount,
                          )}{" "}
                          is fully paid back via bill savings
                        </p>
                      </div>
                    </div>
                    <div className="ml-6 h-8 w-px bg-gradient-to-b from-green-400 to-emerald-400" />
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-xl font-bold text-emerald-300">
                        ∞
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-emerald-50">
                          Years {calculatorResult.loanClearedYear + 1}–15+:
                          Pure profit
                        </p>
                        <p className="text-xs text-emerald-100/70">
                          {pounds(
                            calculatorResult.annualSavingPerHomeAfterLoan,
                          )}
                          /year savings, forever
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/20 bg-black/15 p-4">
                <p className="mb-3 text-sm font-semibold text-emerald-100">
                  Co-op fund allocation & loan repayment (street-level)
                </p>
                <div className="h-[280px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={calculatorResult.yearlySavingsChart.slice(1)}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#14532d" />
                      <XAxis dataKey="year" stroke="#d1fae5" />
                      <YAxis stroke="#d1fae5" />
                      <Tooltip
                        formatter={(value) =>
                          pounds(
                            Number(value ?? 0) * calculatorResult.houseCount,
                          )
                        }
                        contentStyle={{
                          backgroundColor: "#052e16",
                          border: "1px solid #166534",
                          color: "#ecfdf5",
                        }}
                      />
                      <Legend />
                      <Bar
                        dataKey="loanRepayment"
                        stackId="a"
                        fill="#ef4444"
                        name="Co-op loan repayment (collective)"
                      />
                      <Bar
                        dataKey="pocketSaving"
                        stackId="a"
                        fill="#22c55e"
                        name="Distributed to members"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                  <p className="mt-2 text-xs text-emerald-100/60">
                    This shows how the street&apos;s total annual savings are split:
                    red goes to clearing the co-op&apos;s {pounds(calculatorResult.governmentLoanAmount)} loan, green goes into your
                    pockets.
                  </p>
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => toggleSection("details")}
                  className="flex w-full items-center justify-between rounded-xl border border-white/20 bg-black/15 p-4 text-left transition hover:border-emerald-400/40"
                >
                  <span className="text-sm font-semibold text-emerald-100">
                    {expandedSections.has("details") ? "▼" : "▶"} Financial
                    breakdown
                  </span>
                </button>
                {expandedSections.has("details") ? (
                  <div className="mt-3 grid gap-3 rounded-xl border border-white/20 bg-black/15 p-4 md:grid-cols-3">
                    <div className="rounded-lg bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Total co-op fund
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {pounds(calculatorResult.totalCoopFund)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Total install cost
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {pounds(calculatorResult.totalInstallCost)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Year 1 street saving
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {pounds(calculatorResult.grossAnnualStreetSaving)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Per-home saving during loan
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {pounds(calculatorResult.annualSavingPerHomeDuringLoan)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Per-home saving after loan
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {pounds(calculatorResult.annualSavingPerHomeAfterLoan)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/40 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                        Year 15 street saving
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {pounds(calculatorResult.projectedAnnualStreetSavingYear15)}
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => toggleSection("tech")}
                  className="flex w-full items-center justify-between rounded-xl border border-white/20 bg-black/15 p-4 text-left transition hover:border-emerald-400/40"
                >
                  <span className="text-sm font-semibold text-emerald-100">
                    {expandedSections.has("tech") ? "▼" : "▶"} Solar & energy
                    details
                  </span>
                </button>
                {expandedSections.has("tech") ? (
                  <div className="mt-3 rounded-xl border border-white/20 bg-black/15 p-4">
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="rounded-lg bg-black/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                          Solar capacity
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          {calculatorResult.totalPanelsKw.toFixed(1)} kW
                        </p>
                      </div>
                      <div className="rounded-lg bg-black/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                          Estimated panels
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          ~{calculatorResult.estimatedPanelCount}
                        </p>
                      </div>
                      <div className="rounded-lg bg-black/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                          Annual generation
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          {Math.round(calculatorResult.annualGenerationKwh).toLocaleString()}{" "}
                          kWh
                        </p>
                      </div>
                      <div className="rounded-lg bg-black/40 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-200/70">
                          Sun hours/year
                        </p>
                        <p className="mt-1 text-base font-semibold">
                          ~{calculatorResult.sunlightEstimateHours} h
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 rounded-lg bg-black/40 p-4">
                      <p className="mb-3 text-sm font-semibold text-emerald-100">
                        Energy flow breakdown (Year 1)
                      </p>
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-emerald-100/80">
                              Total generated
                            </span>
                            <span className="font-semibold text-emerald-50">
                              {Math.round(
                                calculatorResult.annualGenerationKwh,
                              ).toLocaleString()}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 w-full rounded-full bg-emerald-950/50">
                            <div
                              className="h-2 rounded-full bg-emerald-400"
                              style={{ width: "100%" }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-emerald-100/80">
                              Self-consumed (bill saving)
                            </span>
                            <span className="font-semibold text-green-300">
                              {Math.round(
                                calculatorResult.annualSelfUsedKwh,
                              ).toLocaleString()}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="mt-1.5 h-2 w-full rounded-full bg-emerald-950/50">
                            <div
                              className="h-2 rounded-full bg-green-500"
                              style={{
                                width: `${(calculatorResult.annualSelfUsedKwh / calculatorResult.annualGenerationKwh) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-emerald-100/80">
                              Exported (revenue)
                            </span>
                            <span className="font-semibold text-amber-200">
                              {Math.round(
                                calculatorResult.annualExportedKwh,
                              ).toLocaleString()}{" "}
                              kWh
                            </span>
                          </div>
                          <div className="mt-1.5 h-full rounded-full bg-emerald-950/50">
                            <div
                              className="h-2 rounded-full bg-amber-400"
                              style={{
                                width: `${(calculatorResult.annualExportedKwh / calculatorResult.annualGenerationKwh) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => toggleSection("assumptions")}
                  className="flex w-full items-center justify-between rounded-xl border border-white/20 bg-black/15 p-4 text-left transition hover:border-emerald-400/40"
                >
                  <span className="text-sm font-semibold text-emerald-100">
                    {expandedSections.has("assumptions") ? "▼" : "▶"} Model
                    assumptions
                  </span>
                </button>
                {expandedSections.has("assumptions") ? (
                  <div className="mt-3 rounded-xl border border-white/20 bg-black/15 p-4">
                    <div className="space-y-2 text-sm text-emerald-100/80">
                      <p>
                        <span className="font-semibold text-emerald-50">
                          Member investment:
                        </span>{" "}
                        {pounds(calculatorResult.memberInvestmentTotal)} total
                        (£
                        {Math.round(
                          calculatorResult.memberInvestmentTotal /
                            calculatorResult.houseCount,
                        )}{" "}
                        per home)
                      </p>
                      <p>
                        <span className="font-semibold text-emerald-50">
                          Government loan:
                        </span>{" "}
                        {pounds(calculatorResult.governmentLoanAmount)} at 0%
                        interest
                      </p>
                      <p>
                        <span className="font-semibold text-emerald-50">
                          Roof availability:
                        </span>{" "}
                        {calculatorResult.assumptionsSummary
                          .match(/(\d+)% roof availability/)?.[1] ?? "N/A"}
                        %, avg{" "}
                        {calculatorResult.assumptionsSummary
                          .match(/(\d+\.\d+) kW average roof array/)?.[1] ??
                          "N/A"}{" "}
                        kW per roof
                      </p>
                      <p>
                        <span className="font-semibold text-emerald-50">
                          Energy prices:
                        </span>{" "}
                        Rising at{" "}
                        {calculatorResult.annualEnergyPriceRisePercent.toFixed(
                          1,
                        )}
                        % yearly
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>

            </section>
            ) : null}
          </div>
        </section>

        {geocodeData && clusterData && calculatorResult ? (
          <section className="relative px-6 pb-12 pt-4">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-center">
              <button
                type="button"
                onClick={handleInquiryNow}
                disabled={isInquiring}
                className="rounded-xl bg-green-400 px-6 py-3 text-sm font-bold text-emerald-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isInquiring ? "Running checks..." : "Continue to area checks"}
              </button>
            </div>
          </section>
        ) : null}

        <section id="step4" ref={resultsRef} className="step4-section px-6 pb-20 pt-12 text-white md:pt-16">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            {isInquiring || inquiryResult ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-400">
                    Step 4 | Area Due-Diligence
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white md:text-3xl">
                    Multi-dataset suitability checks
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-emerald-100/85">
                    {isInquiring ? "Running checks..." : "Analyzing your cluster against solar, environmental, and planning datasets."}
                  </p>
                </div>

                <div className="space-y-3">
                  {isInquiring && !inquiryResult ? (
                    // Loading state
                    Array.from({ length: 5 }).map((_, index) => (
                      <div
                        key={index}
                        className="rounded-xl border border-white/20 bg-black/25 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="h-4 w-48 animate-pulse rounded bg-white/10" />
                            <div className="mt-2 h-3 w-full animate-pulse rounded bg-white/5" />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-300/30 border-t-emerald-300" />
                          </div>
                        </div>
                      </div>
                    ))
                  ) : inquiryResult ? (
                    inquiryResult.checks.map((check, index) => {
                      const statusStyles: Record<InquiryCheckStatus, string> = {
                        great: "border-emerald-500/40 bg-emerald-900/20",
                        good: "border-green-500/35 bg-green-900/20",
                        mixed: "border-amber-500/35 bg-amber-900/20",
                        rough: "border-rose-500/40 bg-rose-900/20",
                      };
                      
                      return (
                        <div
                          key={check.id}
                          className={`rounded-xl border p-4 ${statusStyles[check.status]}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-emerald-50">{check.title}</p>
                              <p className="mt-1 text-xs text-emerald-100/80">{check.message}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-emerald-50">{check.score}%</p>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : null}

                  {inquiryResult ? (
                    <div className="mt-6 rounded-2xl border border-green-400/50 bg-gradient-to-br from-green-900/30 to-emerald-950/30 p-6">
                      <div className="text-center">
                        <p className="text-xs font-semibold uppercase tracking-wide text-green-300">
                          Overall Readiness Score
                        </p>
                        <p className="mt-2 text-5xl font-extrabold text-green-400">
                          {inquiryResult?.overallScore}%
                        </p>
                        <p className="mt-2 text-sm text-emerald-100/85">{inquiryResult?.verdict}</p>
                        
                        <button
                          type="button"
                          onClick={handleSubmitInquiry}
                          disabled={inquirySubmitted}
                          className="mt-6 rounded-xl bg-green-400 px-8 py-3 text-sm font-bold text-emerald-950 transition hover:bg-green-300 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {inquirySubmitted ? "✓ Inquiry submitted" : "Submit inquiry"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

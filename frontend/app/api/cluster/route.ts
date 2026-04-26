import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE_URL =
  process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lon = Number(request.nextUrl.searchParams.get("lon"));
  const label =
    request.nextUrl.searchParams.get("label")?.trim() || "Local neighbourhood";

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      { error: "lat and lon query params are required." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `${BACKEND_BASE_URL}/api/v1/cluster?lat=${lat}&lon=${lon}&label=${encodeURIComponent(label)}`,
      { cache: "no-store" },
    );

    const body = (await response.json()) as unknown;

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            typeof body === "object" &&
            body !== null &&
            "detail" in body &&
            typeof (body as { detail?: unknown }).detail === "string"
              ? (body as { detail: string }).detail
              : "Cluster lookup failed in backend.",
        },
        { status: response.status },
      );
    }

    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to reach backend cluster service.",
      },
      { status: 502 },
    );
  }
}

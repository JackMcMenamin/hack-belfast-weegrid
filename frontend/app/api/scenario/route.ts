import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE_URL =
  process.env.BACKEND_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function POST(request: NextRequest) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body for scenario calculation request." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(
      `${BACKEND_BASE_URL}/api/v1/scenario/calculate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(payload),
      },
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
              : "Scenario calculation failed in backend.",
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
            : "Unable to reach backend scenario service.",
      },
      { status: 502 },
    );
  }
}

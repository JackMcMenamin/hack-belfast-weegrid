const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const REQUEST_TIMEOUT_MS = 12_000;

export type OverpassRunResult<T> =
  | { ok: true; data: T; endpoint: string }
  | { ok: false; error: string; attempts: { endpoint: string; reason: string }[] };

async function fetchWithTimeout(
  endpoint: string,
  query: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: "POST",
      body: query,
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": "WeeGrid-HackBelfast/1.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function runOverpass<T>(query: string): Promise<OverpassRunResult<T>> {
  const attempts: { endpoint: string; reason: string }[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, query);
      if (!response.ok) {
        attempts.push({ endpoint, reason: `HTTP ${response.status}` });
        continue;
      }

      const text = await response.text();
      if (!text) {
        attempts.push({ endpoint, reason: "empty body" });
        continue;
      }

      try {
        const data = JSON.parse(text) as T;
        return { ok: true, data, endpoint };
      } catch (parseErr) {
        attempts.push({
          endpoint,
          reason: `parse error: ${(parseErr as Error).message}`,
        });
        continue;
      }
    } catch (err) {
      const reason =
        err instanceof Error
          ? err.name === "AbortError"
            ? "timeout"
            : err.message
          : "unknown error";
      attempts.push({ endpoint, reason });
    }
  }

  return {
    ok: false,
    error: "All Overpass endpoints failed.",
    attempts,
  };
}

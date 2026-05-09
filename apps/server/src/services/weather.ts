import type { BoundingBox, WeatherCell } from "@strait-command/shared";

/** Open-Meteo: sample grid for routing / fuel weighting; adverse = strong wind or heavy precip */
const WIND_ADV_MPS = 12;
const PRECIP_ADV_MM = 2;

export async function fetchWeatherGrid(bbox: BoundingBox, grid = 5): Promise<WeatherCell[]> {
  const lats: number[] = [];
  const lngs: number[] = [];
  for (let i = 0; i < grid; i++) {
    const t = i / (grid - 1 || 1);
    lats.push(bbox.south + t * (bbox.north - bbox.south));
    lngs.push(bbox.west + t * (bbox.east - bbox.west));
  }
  const tasks: Promise<WeatherCell>[] = [];
  for (const lat of lats) {
    for (const lng of lngs) {
      tasks.push(sampleCell(lat, lng));
    }
  }
  return Promise.all(tasks);
}

async function sampleCell(lat: number, lng: number): Promise<WeatherCell> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("current", "wind_speed_10m,precipitation");
  url.searchParams.set("wind_speed_unit", "ms");
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    return { lat, lng, windSpeedMs: 0, precipitationMm: 0, adverse: false };
  }
  const j = (await res.json()) as {
    current?: { wind_speed_10m?: number; precipitation?: number };
  };
  const wind = j.current?.wind_speed_10m ?? 0;
  const precip = j.current?.precipitation ?? 0;
  return {
    lat,
    lng,
    windSpeedMs: wind,
    precipitationMm: precip,
    adverse: wind >= WIND_ADV_MPS || precip >= PRECIP_ADV_MM,
  };
}

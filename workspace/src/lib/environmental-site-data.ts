import { getEnvVar } from "@/lib/backend";

export interface EnvironmentalSiteDataInput {
  question?: string;
  description?: string;
  location?: string;
  latitude?: number | string;
  longitude?: number | string;
  radius_km?: number | string;
}

interface SiteLocation {
  lat: number;
  lon: number;
  label: string;
  source: "coordinates" | "geocode";
}

interface ProviderResult {
  source: string;
  status: "available" | "degraded" | "unavailable_config" | "failed";
  metrics: Record<string, unknown>;
  caveat?: string;
  provenance: string;
}

export interface EnvironmentalSiteDataResult {
  status: "complete" | "needs_location";
  location: SiteLocation | null;
  radius_km: number;
  executive_summary: string;
  confidence: string;
  computed_metrics: Array<{ label: string; value: string; unit?: string; note?: string }>;
  supported_claims: Array<{ claim: string; evidence: string }>;
  limitations: string[];
  recommended_actions: string[];
  provider_results: ProviderResult[];
  configured_credentials: Array<{ provider: string; configured: boolean; enables: string }>;
}

const DEFAULT_RADIUS_KM = 5;
const FETCH_TIMEOUT_MS = 10_000;

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampRadius(value: unknown): number {
  const parsed = num(value);
  if (parsed === null || parsed <= 0) return DEFAULT_RADIUS_KM;
  return Math.min(parsed, 100);
}

function validLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function applyDirection(value: number, direction?: string): number {
  const dir = (direction || "").toUpperCase();
  if (dir === "S" || dir === "W") return -Math.abs(value);
  if (dir === "N" || dir === "E") return Math.abs(value);
  return value;
}

export function extractSiteCoordinates(text: string): SiteLocation | null {
  const normalized = text.replace(/[()]/g, " ");
  const directed = normalized.match(/(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])\b[,\s]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])\b/i);
  if (directed) {
    const lat = applyDirection(Number(directed[1]), directed[2]);
    const lon = applyDirection(Number(directed[3]), directed[4]);
    if (validLatLon(lat, lon)) {
      return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, source: "coordinates" };
    }
  }

  const labeled = normalized.match(/\b(?:lat|latitude)\s*[:=]?\s*(-?\d{1,2}(?:\.\d+)?)[,\s;]+(?:lon|lng|long|longitude)\s*[:=]?\s*(-?\d{1,3}(?:\.\d+)?)/i);
  if (labeled) {
    const lat = Number(labeled[1]);
    const lon = Number(labeled[2]);
    if (validLatLon(lat, lon)) {
      return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, source: "coordinates" };
    }
  }

  const plain = normalized.match(/\b(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\b/);
  if (plain) {
    const lat = Number(plain[1]);
    const lon = Number(plain[2]);
    if (validLatLon(lat, lon)) {
      return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, source: "coordinates" };
    }
  }

  return null;
}

function credentialsStatus(): EnvironmentalSiteDataResult["configured_credentials"] {
  return [
    {
      provider: "NASA Earthdata",
      configured: !!getEnvVar("EARTHDATA_USERNAME") && !!getEnvVar("EARTHDATA_PASSWORD"),
      enables: "SMAP soil moisture and NASA earth-observation layers when the Nature Engine bridge is enabled",
    },
    {
      provider: "Copernicus CDS",
      configured: !!getEnvVar("CDS_API_KEY"),
      enables: "ERA5 and Climate Data Store reanalysis workflows",
    },
    {
      provider: "NASA FIRMS",
      configured: !!getEnvVar("FIRMS_MAP_KEY"),
      enables: "VIIRS active-fire detections",
    },
    {
      provider: "GBIF login",
      configured: !!getEnvVar("GBIF_USERNAME") && !!getEnvVar("GBIF_PASSWORD"),
      enables: "authenticated GBIF workflows; public occurrence search also works without login",
    },
  ];
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Exergy Analyst environmental-site-data/1.0",
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function firstMetric(data: unknown, name: string): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const layers = (data as { properties?: { layers?: unknown[] } }).properties?.layers;
  if (!Array.isArray(layers)) return null;
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) continue;
    if ((layer as { name?: string }).name !== name) continue;
    const depths = (layer as { depths?: unknown[] }).depths;
    if (!Array.isArray(depths)) continue;
    for (const depth of depths) {
      if (!depth || typeof depth !== "object" || Array.isArray(depth)) continue;
      const values = (depth as { values?: Record<string, unknown> }).values;
      const mean = values?.mean;
      if (typeof mean === "number" && Number.isFinite(mean)) return mean;
    }
  }
  return null;
}

async function reverseGeocode(location: SiteLocation): Promise<ProviderResult> {
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(location.lat),
      lon: String(location.lon),
      zoom: "10",
      addressdetails: "1",
    });
    const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`) as Record<string, unknown>;
    const address = data.address && typeof data.address === "object" ? data.address as Record<string, unknown> : {};
    return {
      source: "openstreetmap_nominatim",
      status: "available",
      metrics: {
        display_name: data.display_name,
        country: address.country,
        region: address.state || address.region || address.county,
      },
      caveat: "Reverse geocoding is a place label, not an environmental measurement.",
      provenance: "OpenStreetMap Nominatim reverse geocode",
    };
  } catch (error) {
    return failedProvider("openstreetmap_nominatim", error, "Reverse geocoding unavailable");
  }
}

async function fetchWeather(location: SiteLocation): Promise<ProviderResult> {
  try {
    const params = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: "temperature_2m,relative_humidity_2m,wind_speed_10m",
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum",
      timezone: "UTC",
      forecast_days: "1",
    });
    const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params.toString()}`) as Record<string, unknown>;
    const current = data.current && typeof data.current === "object" ? data.current as Record<string, unknown> : {};
    const daily = data.daily && typeof data.daily === "object" ? data.daily as Record<string, unknown[]> : {};
    return {
      source: "open_meteo_weather",
      status: "available",
      metrics: {
        temperature_2m_c: current.temperature_2m,
        relative_humidity_2m_pct: current.relative_humidity_2m,
        wind_speed_10m_kmh: current.wind_speed_10m,
        daily_temperature_max_c: Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : undefined,
        daily_temperature_min_c: Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : undefined,
        daily_precipitation_mm: Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum[0] : undefined,
        daily_shortwave_radiation_mj_m2: Array.isArray(daily.shortwave_radiation_sum) ? daily.shortwave_radiation_sum[0] : undefined,
      },
      caveat: "Open-Meteo values are gridded/forecast context, not on-site measurements.",
      provenance: "Open-Meteo forecast API",
    };
  } catch (error) {
    return failedProvider("open_meteo_weather", error, "Weather context unavailable");
  }
}

async function fetchAirQuality(location: SiteLocation): Promise<ProviderResult> {
  try {
    const params = new URLSearchParams({
      latitude: String(location.lat),
      longitude: String(location.lon),
      current: "pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi",
      timezone: "UTC",
    });
    const data = await fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`) as Record<string, unknown>;
    const current = data.current && typeof data.current === "object" ? data.current as Record<string, unknown> : {};
    return {
      source: "open_meteo_air_quality",
      status: "available",
      metrics: {
        us_aqi: current.us_aqi,
        pm2_5_ug_m3: current.pm2_5,
        pm10_ug_m3: current.pm10,
        no2_ug_m3: current.nitrogen_dioxide,
        so2_ug_m3: current.sulphur_dioxide,
        ozone_ug_m3: current.ozone,
        carbon_monoxide_ug_m3: current.carbon_monoxide,
      },
      caveat: "Air-quality data is gridded model/reanalysis context; verify with local monitors for permitting or health claims.",
      provenance: "Open-Meteo Air Quality API",
    };
  } catch (error) {
    return failedProvider("open_meteo_air_quality", error, "Air-quality context unavailable");
  }
}

async function fetchSoil(location: SiteLocation): Promise<ProviderResult> {
  try {
    const params = new URLSearchParams({
      lon: String(location.lon),
      lat: String(location.lat),
      depth: "0-30cm",
      value: "mean",
    });
    for (const property of ["ocs", "phh2o", "clay", "sand", "bdod"]) {
      params.append("property", property);
    }
    const data = await fetchJson(`https://rest.isric.org/soilgrids/v2.0/properties/query?${params.toString()}`);
    const ocs = firstMetric(data, "ocs");
    const ph = firstMetric(data, "phh2o");
    const clay = firstMetric(data, "clay");
    const sand = firstMetric(data, "sand");
    const bdod = firstMetric(data, "bdod");
    return {
      source: "soilgrids",
      status: "available",
      metrics: {
        soil_organic_carbon_t_ha_0_30cm: ocs === null ? undefined : round(ocs / 10, 1),
        ph_h2o_0_30cm: ph === null ? undefined : round(ph / 10, 1),
        clay_pct_0_30cm: clay === null ? undefined : round(clay / 10, 1),
        sand_pct_0_30cm: sand === null ? undefined : round(sand / 10, 1),
        bulk_density_g_cm3_0_30cm: bdod === null ? undefined : round(bdod / 100, 2),
      },
      caveat: "SoilGrids is a 250m centroid query; heterogeneous sites need multi-point sampling.",
      provenance: "ISRIC SoilGrids v2.0 properties API, 0-30cm depth",
    };
  } catch (error) {
    return failedProvider("soilgrids", error, "Soil context unavailable");
  }
}

async function fetchBiodiversity(location: SiteLocation, radiusKm: number): Promise<ProviderResult> {
  try {
    const latOffset = radiusKm / 111;
    const lonOffset = radiusKm / (111 * Math.max(0.1, Math.abs(Math.cos(location.lat * Math.PI / 180))));
    const params = new URLSearchParams({
      decimalLatitude: `${location.lat - latOffset},${location.lat + latOffset}`,
      decimalLongitude: `${location.lon - lonOffset},${location.lon + lonOffset}`,
      limit: "300",
      hasCoordinate: "true",
      hasGeospatialIssue: "false",
    });
    const data = await fetchJson(`https://api.gbif.org/v1/occurrence/search?${params.toString()}`) as Record<string, unknown>;
    const records = Array.isArray(data.results) ? data.results : [];
    const species = new Set<string>();
    const groups = new Set<string>();
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const item = record as Record<string, unknown>;
      if (typeof item.species === "string" && item.species.trim()) species.add(item.species.trim());
      if (typeof item.class === "string" && item.class.trim()) groups.add(item.class.trim().toLowerCase());
    }
    return {
      source: "gbif_occurrence",
      status: "available",
      metrics: {
        occurrence_records: typeof data.count === "number" ? data.count : records.length,
        unique_species_in_sample: species.size,
        taxonomic_groups_in_sample: Array.from(groups).slice(0, 8).join(", "),
        query_radius_km: radiusKm,
      },
      caveat: "GBIF records reflect observation effort and observer bias; this is occurrence-based context, not field-verified biodiversity condition.",
      provenance: "GBIF Occurrence API",
    };
  } catch (error) {
    return failedProvider("gbif_occurrence", error, "Biodiversity occurrence context unavailable");
  }
}

async function fetchFire(location: SiteLocation): Promise<ProviderResult> {
  const key = getEnvVar("FIRMS_MAP_KEY");
  if (!key) {
    return {
      source: "nasa_firms_viirs",
      status: "unavailable_config",
      metrics: {},
      caveat: "FIRMS_MAP_KEY is not configured. Add the NASA FIRMS key to the environment to collect active-fire detections.",
      provenance: "NASA FIRMS VIIRS endpoint not queried because API key is unavailable",
    };
  }

  try {
    const bufferDeg = 5 / 111;
    const west = location.lon - bufferDeg;
    const south = location.lat - bufferDeg;
    const east = location.lon + bufferDeg;
    const north = location.lat + bufferDeg;
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/${west},${south},${east},${north}/10`;
    const csv = await fetchText(url, { headers: { Accept: "text/csv" } });
    const lines = csv.trim().split(/\r?\n/).filter(Boolean);
    const detections = lines.length > 1 ? lines.length - 1 : 0;
    return {
      source: "nasa_firms_viirs",
      status: "available",
      metrics: {
        active_fire_detections_10d: detections,
        search_buffer_km: 5,
      },
      caveat: "VIIRS active-fire detections are recent thermal anomalies at coarse resolution; absence of detections is not proof of no fire risk.",
      provenance: "NASA FIRMS VIIRS SNPP NRT area CSV API, 10-day window",
    };
  } catch (error) {
    return failedProvider("nasa_firms_viirs", error, "FIRMS fire context unavailable");
  }
}

function failedProvider(source: string, error: unknown, caveat: string): ProviderResult {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  return {
    source,
    status: "failed",
    metrics: {},
    caveat: `${caveat}: ${message}`,
    provenance: `${source} request failed`,
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function metricValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function pushMetric(
  out: EnvironmentalSiteDataResult["computed_metrics"],
  provider: ProviderResult,
  key: string,
  label: string,
  unit?: string,
  note?: string,
) {
  const value = metricValue(provider.metrics[key]);
  if (!value) return;
  out.push({ label, value, unit, note: note || provider.source });
}

function buildComputedMetrics(providerResults: ProviderResult[]): EnvironmentalSiteDataResult["computed_metrics"] {
  const out: EnvironmentalSiteDataResult["computed_metrics"] = [];
  for (const provider of providerResults) {
    pushMetric(out, provider, "display_name", "Site label");
    pushMetric(out, provider, "country", "Country");
    pushMetric(out, provider, "region", "Region");
    pushMetric(out, provider, "temperature_2m_c", "Current air temperature", "C");
    pushMetric(out, provider, "relative_humidity_2m_pct", "Current relative humidity", "%");
    pushMetric(out, provider, "wind_speed_10m_kmh", "Wind speed at 10m", "km/h");
    pushMetric(out, provider, "daily_precipitation_mm", "Daily precipitation", "mm/day");
    pushMetric(out, provider, "daily_shortwave_radiation_mj_m2", "Daily shortwave radiation", "MJ/m2/day");
    pushMetric(out, provider, "us_aqi", "US AQI");
    pushMetric(out, provider, "pm2_5_ug_m3", "PM2.5", "ug/m3");
    pushMetric(out, provider, "pm10_ug_m3", "PM10", "ug/m3");
    pushMetric(out, provider, "no2_ug_m3", "NO2", "ug/m3");
    pushMetric(out, provider, "soil_organic_carbon_t_ha_0_30cm", "Soil organic carbon 0-30cm", "t/ha");
    pushMetric(out, provider, "ph_h2o_0_30cm", "Soil pH 0-30cm");
    pushMetric(out, provider, "clay_pct_0_30cm", "Clay 0-30cm", "%");
    pushMetric(out, provider, "sand_pct_0_30cm", "Sand 0-30cm", "%");
    pushMetric(out, provider, "occurrence_records", "GBIF occurrence records");
    pushMetric(out, provider, "unique_species_in_sample", "Unique species in GBIF sample");
    pushMetric(out, provider, "taxonomic_groups_in_sample", "Taxonomic groups in GBIF sample");
    pushMetric(out, provider, "active_fire_detections_10d", "Active fire detections, last 10 days");
  }
  return out.slice(0, 24);
}

function metricLookup(metrics: EnvironmentalSiteDataResult["computed_metrics"], label: RegExp): string {
  const found = metrics.find((metric) => label.test(metric.label));
  if (!found) return "";
  return `${found.value}${found.unit ? ` ${found.unit}` : ""}`;
}

function buildSummary(location: SiteLocation, metrics: EnvironmentalSiteDataResult["computed_metrics"], providers: ProviderResult[]): string {
  const available = providers.filter((provider) => provider.status === "available").map((provider) => provider.source.replace(/_/g, " "));
  const temp = metricLookup(metrics, /air temperature/i);
  const aqi = metricLookup(metrics, /US AQI/i);
  const soilCarbon = metricLookup(metrics, /soil organic carbon/i);
  const species = metricLookup(metrics, /unique species/i);
  const fire = metricLookup(metrics, /active fire/i);
  const signals = [
    temp ? `air temperature ${temp}` : "",
    aqi ? `US AQI ${aqi}` : "",
    soilCarbon ? `soil organic carbon ${soilCarbon}` : "",
    species ? `${species} unique species in the GBIF sample` : "",
    fire ? `${fire} recent VIIRS fire detections` : "",
  ].filter(Boolean);
  return [
    `I collected environmental site context for ${location.label} (${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}).`,
    available.length ? `Available layers: ${available.join(", ")}.` : "No remote environmental layers returned data.",
    signals.length ? `Key signals: ${signals.slice(0, 5).join("; ")}.` : "No numeric environmental signal was strong enough to summarize yet.",
  ].join(" ");
}

async function geocodeLocation(value: string): Promise<SiteLocation | null> {
  const cleaned = value.trim();
  if (!cleaned) return null;
  try {
    const params = new URLSearchParams({ q: cleaned, format: "jsonv2", limit: "1" });
    const data = await fetchJson(`https://nominatim.openstreetmap.org/search?${params.toString()}`) as unknown;
    if (!Array.isArray(data) || data.length === 0) return null;
    const first = data[0] as Record<string, unknown>;
    const lat = num(first.lat);
    const lon = num(first.lon);
    if (lat === null || lon === null || !validLatLon(lat, lon)) return null;
    return {
      lat,
      lon,
      label: typeof first.display_name === "string" ? first.display_name : cleaned,
      source: "geocode",
    };
  } catch {
    return null;
  }
}

async function resolveLocation(input: EnvironmentalSiteDataInput): Promise<SiteLocation | null> {
  const explicitLat = num(input.latitude);
  const explicitLon = num(input.longitude);
  if (explicitLat !== null && explicitLon !== null && validLatLon(explicitLat, explicitLon)) {
    return { lat: explicitLat, lon: explicitLon, label: `${explicitLat.toFixed(4)}, ${explicitLon.toFixed(4)}`, source: "coordinates" };
  }

  const text = [input.location, input.question, input.description].filter(Boolean).join("\n");
  const parsed = extractSiteCoordinates(text);
  if (parsed) return parsed;

  if (input.location && !extractSiteCoordinates(input.location)) {
    const geocoded = await geocodeLocation(input.location);
    if (geocoded) return geocoded;
  }

  return null;
}

export async function collectEnvironmentalSiteData(input: EnvironmentalSiteDataInput): Promise<EnvironmentalSiteDataResult> {
  const radiusKm = clampRadius(input.radius_km);
  const configuredCredentials = credentialsStatus();
  const location = await resolveLocation(input);
  if (!location) {
    return {
      status: "needs_location",
      location: null,
      radius_km: radiusKm,
      executive_summary: "I need a site location before I can collect environmental layers. Provide coordinates, a site address, or a named location.",
      confidence: "Blocked until a location is provided",
      computed_metrics: [],
      supported_claims: [],
      limitations: ["No site-specific environmental data can be collected without latitude/longitude or a geocodable place name."],
      recommended_actions: ["Provide coordinates as latitude and longitude, or give a site address/name plus the radius to evaluate."],
      provider_results: [],
      configured_credentials: configuredCredentials,
    };
  }

  const providerResults = await Promise.all([
    reverseGeocode(location),
    fetchWeather(location),
    fetchAirQuality(location),
    fetchSoil(location),
    fetchBiodiversity(location, radiusKm),
    fetchFire(location),
  ]);
  const computedMetrics = buildComputedMetrics(providerResults);
  const availableCount = providerResults.filter((provider) => provider.status === "available").length;
  const executiveSummary = buildSummary(location, computedMetrics, providerResults);
  const limitations = Array.from(new Set([
    ...providerResults.map((provider) => provider.caveat || "").filter(Boolean),
    "This remote context does not replace site surveys, permit records, stack tests, hydrology studies, or local monitoring data.",
  ])).slice(0, 8);

  return {
    status: "complete",
    location,
    radius_km: radiusKm,
    executive_summary: executiveSummary,
    confidence: availableCount >= 4
      ? "Multiple independent remote layers returned data"
      : availableCount >= 2
        ? "Limited remote layers returned data"
        : "Low; remote layer coverage is sparse",
    computed_metrics: computedMetrics,
    supported_claims: [
      {
        claim: "Site-specific environmental context was collected from remote data services.",
        evidence: `${availableCount} provider layer(s) returned data for ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)}.`,
      },
      {
        claim: "The result can support early environmental review and data-request planning.",
        evidence: "The collected layers cover weather, air quality, soil, biodiversity occurrence records, geocoding, and configured fire-detection status where available.",
      },
    ],
    limitations,
    recommended_actions: [
      "Use this as a site context layer, then request local monitoring records, permit limits, water data, habitat surveys, and project boundary details.",
      "For project-grade environmental analysis, provide the facility footprint, process emissions, water withdrawal/discharge points, operating schedule, and any applicable permits.",
      "If fire, soil moisture, or climate reanalysis is decision-critical, configure the missing provider keys or run the Nature Engine bridge with the full remote-sensing stack.",
    ],
    provider_results: providerResults,
    configured_credentials: configuredCredentials,
  };
}

import {
  collectEnvironmentalSiteData,
  extractSiteCoordinates,
} from "@/lib/environmental-site-data";

describe("environmental site data", () => {
  const originalFetch = global.fetch;
  const originalFirms = process.env.FIRMS_MAP_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalFirms === undefined) delete process.env.FIRMS_MAP_KEY;
    else process.env.FIRMS_MAP_KEY = originalFirms;
    jest.restoreAllMocks();
  });

  it("extracts coordinates with cardinal directions", () => {
    const location = extractSiteCoordinates("Assess environmental risk at 24.1456 N, 54.5318 E");
    expect(location).toMatchObject({ lat: 24.1456, lon: 54.5318, source: "coordinates" });
  });

  it("collects environmental layers for a site", async () => {
    delete process.env.FIRMS_MAP_KEY;
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("nominatim.openstreetmap.org/reverse")) {
        return Response.json({
          display_name: "Test Industrial Site, Example Region",
          address: { country: "Exampleland", state: "Example Region" },
        });
      }
      if (url.includes("api.open-meteo.com/v1/forecast")) {
        return Response.json({
          current: { temperature_2m: 31.4, relative_humidity_2m: 42, wind_speed_10m: 14.2 },
          daily: {
            temperature_2m_max: [36],
            temperature_2m_min: [25],
            precipitation_sum: [0.8],
            shortwave_radiation_sum: [24.5],
          },
        });
      }
      if (url.includes("air-quality-api.open-meteo.com")) {
        return Response.json({
          current: {
            us_aqi: 58,
            pm2_5: 12.4,
            pm10: 35.1,
            nitrogen_dioxide: 18.2,
            sulphur_dioxide: 4.1,
            ozone: 76.3,
            carbon_monoxide: 180,
          },
        });
      }
      if (url.includes("rest.isric.org/soilgrids")) {
        return Response.json({
          properties: {
            layers: [
              { name: "ocs", depths: [{ label: "0-30cm", values: { mean: 450 } }] },
              { name: "phh2o", depths: [{ label: "0-30cm", values: { mean: 65 } }] },
              { name: "clay", depths: [{ label: "0-30cm", values: { mean: 300 } }] },
              { name: "sand", depths: [{ label: "0-30cm", values: { mean: 410 } }] },
              { name: "bdod", depths: [{ label: "0-30cm", values: { mean: 128 } }] },
            ],
          },
        });
      }
      if (url.includes("api.gbif.org")) {
        return Response.json({
          count: 2,
          results: [
            { species: "Acacia tortilis", class: "Magnoliopsida" },
            { species: "Vulpes vulpes", class: "Mammalia" },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as unknown as typeof fetch;

    const result = await collectEnvironmentalSiteData({
      question: "What environmental concerns exist at 24.1456 N, 54.5318 E?",
    });

    expect(result.status).toBe("complete");
    expect(result.location).toMatchObject({ lat: 24.1456, lon: 54.5318 });
    expect(result.executive_summary).toContain("Available layers");
    expect(result.computed_metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Current air temperature", value: "31.4", unit: "C" }),
        expect.objectContaining({ label: "US AQI", value: "58" }),
        expect.objectContaining({ label: "Soil organic carbon 0-30cm", value: "45", unit: "t/ha" }),
        expect.objectContaining({ label: "Unique species in GBIF sample", value: "2" }),
      ]),
    );
    expect(result.provider_results.find((provider) => provider.source === "nasa_firms_viirs")?.status).toBe("unavailable_config");
    expect(result.limitations.join(" ")).toMatch(/remote context does not replace site surveys/i);
  });
});

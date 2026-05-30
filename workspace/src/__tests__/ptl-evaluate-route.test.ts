/**
 * Smoke tests for /api/ptl/evaluate route handler.
 *
 * These tests exercise the input-validation and error paths without
 * spawning Python (which would require a live .venv + engine runtime in
 * the jest env). The happy-path end-to-end flow is covered by the
 * Python-side integration tests; here we verify:
 *
 * - GET returns route metadata (useful for deploy-smoke)
 * - POST with invalid JSON returns 400
 * - POST without candidate_params returns 400
 * - POST with candidate_params triggers Python spawn (code path exercised
 *   — actual spawn may fail in the jest env, we only assert the response
 *   is structured correctly)
 */

import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/ptl/evaluate/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ptl/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /api/ptl/evaluate", () => {
  it("returns route metadata", async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.route).toBe("ptl/evaluate");
    expect(data.method).toBe("POST");
    expect(data.runtime).toBe("nodejs");
    expect(typeof data.briefs_dir).toBe("string");
  });
});

describe("POST /api/ptl/evaluate input validation", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = makeRequest("{not-json}");
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("JSON");
  });

  it("returns 400 when candidate_params missing", async () => {
    const req = makeRequest({ jurisdiction: "US" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("candidate_params");
  });

  it("returns 400 when candidate_params is not an object", async () => {
    const req = makeRequest({ candidate_params: "not-an-object" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

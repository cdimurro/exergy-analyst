import { expect, test } from "@playwright/test";

const ACTIVE_STATUS_RE =
  /Working on your request|Reading (?:the request|\d+ uploaded file)|preparing the run|Checking attached files|Choosing whether|Reviewing the request|Running|Checking intermediate|Writing the final answer|Starting a server-owned run|Run started|Preparing the isolated workspace|Generating and running/i;

function pdfBytes(lines: string[]): Buffer {
  const escapePdf = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT",
    "/F1 10 Tf",
    "50 750 Td",
    ...lines
      .flatMap((line, index) => [`(${escapePdf(line)}) Tj`, index === lines.length - 1 ? "" : "0 -14 Td"])
      .filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index++) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output);
}

test("uploaded unfamiliar document returns a compact useful chat answer", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI upload analysis smoke",
      description: "Browser QA for current-upload analysis.",
      goal: "Return a useful answer from the current file through the chat UI.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  const filename = "unfamiliar circular materials investment note.pdf";
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "HelioLoop Circular Materials Investment Note",
      "The project recovers high purity silica and sodium salts from municipal glass fines.",
      "Pilot throughput is 18 tonnes per day with planned expansion to 72 tonnes per day.",
      "The deck estimates total installed cost of 42 million USD and annual operating cost of 8.5 million USD.",
      "Expected revenue is 17.8 million USD per year from recovered materials and disposal fees.",
      "The claimed environmental benefits are 31,000 tonnes per year of avoided landfill disposal and 12,400 tonnes CO2e per year of avoided emissions.",
      "The document does not include audited financials, a signed offtake agreement, or third party lifecycle assessment.",
    ]),
  });
  await expect(page.getByText(filename)).toBeVisible();

  await input.fill("Can you analyze this file for me? I need an economic and environmental readout in plain English.");
  await input.press("Enter");

  await expect(page.getByText(/42 million USD/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/17\.8 million USD/).first()).toBeVisible();
  await expect(page.getByText(/12,400 tonnes CO2e/).first()).toBeVisible();

  await expect(page.getByText("Use as a triage note")).toHaveCount(0);
  await expect(page.getByText("What Is Supported")).toHaveCount(0);
  await expect(page.getByText("Do Not Claim Yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);
  await expect(page.getByText(/Fischer[- ]Tropsch|syngas|cobalt catalysts/i)).toHaveCount(0);
});

test("simple market-price question stays a plain chat answer", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI simple question smoke",
      description: "Browser QA for simple chat answers.",
      goal: "Return a concise useful answer without artifact report chrome.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  await input.fill("What is currently the cheapest solar panel per watt that I can buy online?");
  await input.press("Enter");

  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/solar|panel|module|watt|price|USD\/W|per watt/i).last()).toBeVisible();
  await expect(page.getByText("Literature search complete")).toHaveCount(0);
  await expect(page.getByText(/^Research:/)).toHaveCount(0);
  await expect(page.getByText("Detailed View")).toHaveCount(0);
  await expect(page.getByText("Key Sources")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);
});

test("refresh during an active uploaded-file run restores the final answer", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI active refresh smoke",
      description: "Browser QA for reconnecting to an active run.",
      goal: "Refresh while a server-owned run is active and restore the final answer.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  const filename = "active-refresh-process-note.pdf";
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "Active Refresh Process Note",
      "The process recovers 5.2 MW of waste heat from compressor discharge cooling.",
      "Available heat is 82 C supply and 48 C return for 6,100 operating hours per year.",
      "Estimated installed cost is 9.6 million USD with expected annual avoided fuel cost of 1.7 million USD.",
      "The note does not include metered hourly load duration or final interconnection design.",
    ]),
  });
  await expect(page.getByText(filename)).toBeVisible();

  await input.fill("Analyze this file and summarize the economics and limits.");
  await input.press("Enter");
  await expect(page.getByText(ACTIVE_STATUS_RE).first()).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByText(/9\.6 million USD|1\.7 million USD|5\.2 MW/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/View Details|Export Report|Do Not Claim Yet|What Is Supported/i)).toHaveCount(0);
});

test("home screen Enter creates a workspace run from an uploaded PDF", async ({ page }) => {
  await page.goto("/");
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: /Mode:/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Thinking Level:/i })).toHaveCount(0);

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "home-enter-waste-heat.pdf",
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "Home Enter Waste Heat Note",
      "The heat recovery opportunity is 3.4 MW at 91 C for 5,500 hours per year.",
      "Estimated installed cost is 5.1 million USD with avoided fuel savings of 920,000 USD per year.",
      "The note does not include hourly load duration or final tie-in drawings.",
    ]),
  });
  await expect(page.getByText("home-enter-waste-heat.pdf")).toBeVisible();

  await input.fill("Analyze this file and explain the economics and limits.");
  await input.press("Enter");

  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(/View Details|Export Report|Do Not Claim Yet|What Is Supported/i)).toHaveCount(0);
});

test("SOEC PDF analysis uses natural document language", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI SOEC PDF language smoke",
      description: "Browser QA for domain-specific PDF summary language.",
      goal: "Return a natural SOEC summary without extraction metadata.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  const filename = "oxeon SOEC info sheet rev2.pdf";
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "High temperature electrolysis / co-electrolysis",
      "SOEC and HTCE technology",
      "The solid oxide electrolysis (SOEC) and high temperature co-electrolysis (HTCE) technologies are based on OxEon's previous experience with solid oxide fuel cells.",
      "A SOEC uses electricity to generate hydrogen from steam or synthesis gas from steam plus CO2.",
      "SOEC produces about 28 metric tons of H2 per GWh compared with about 21 metric tons for a low temperature system.",
      "OxEon has shown resultant synthesis gas from HTCE can be fed to a Fischer Tropsch reactor to make synthetic fuel.",
      "The largest SOEC unit produced to date was the 18 kWe unit and at full capacity produced about 5000 lph of H2.",
      "It ran roughly 1000 hours in electrolysis mode and roughly 1000 hours in co-electrolysis mode.",
      "Each 60 cell stack would generate about twenty-one (21) liters per minute of H2.",
    ]),
  });
  await expect(page.getByText(filename)).toBeVisible();

  await input.fill("Can you please analyze this pdf for me?");
  await input.press("Enter");

  await expect(page.getByText(/SOEC and high-temperature co-electrolysis information sheet/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/steam electrolysis uses electricity/i).first()).toBeVisible();
  await expect(page.getByText(/co-electrolysis of steam and CO2/i).first()).toBeVisible();
  await expect(page.getByText(/28 metric tons/).first()).toBeVisible();
  await expect(page.getByText(/18 kWe/).first()).toBeVisible();
  await expect(page.getByText(/5000 lph/).first()).toBeVisible();
  await expect(page.getByText(/1,000 hours|1000 hours/).first()).toBeVisible();
  await expect(page.getByText(/21 lpm|21 liters per minute/).first()).toBeVisible();
  await expect(page.getByText(/Caveat:/i)).toHaveCount(0);
  await expect(page.getByText(/does not independently validate/i)).toHaveCount(0);
  await expect(page.getByText(/The extract has about/i)).toHaveCount(0);
  await expect(page.getByText(/Detected signals/i)).toHaveCount(0);
  await expect(page.getByText(/notable quantitative value/i)).toHaveCount(0);
  await expect(page.getByText(/Use this as a content-grounded summary/i)).toHaveCount(0);
  await expect(page.getByText(/rightarrow|H-2O|CO-2/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);
});

test("PV datasheet simulation completes without heat-pump fallback", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI PV module simulation smoke",
      description: "Browser QA for uploaded PV module datasheet simulation.",
      goal: "Extract PV specs and return one-module production metrics.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  const filename = "Canadian_Solar-Datasheet-HiKu_CS3W-MS_EN.pdf";
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "Canadian Solar HiKu CS3W-MS",
      "Nominal Max. Power (Pmax) W 380 385 390 395 400",
      "Module Efficiency % 19.16 19.41 19.66 19.91 20.16",
      "Open Circuit Voltage (Voc) V 46.4 46.6 46.8 47.0 47.2",
      "Short Circuit Current (Isc) A 10.88 10.91 10.94 10.97 11.00",
      "Optimum Operating Voltage (Vmp) V 38.5 38.7 38.9 39.1 39.3",
      "Optimum Operating Current (Imp) A 9.87 9.95 10.03 10.11 10.18",
      "Temperature Coefficient (Pmax) -0.37 % / C",
      "Cell Type Mono-crystalline 144 cells",
      "Dimensions 2000 x 992 x 35 mm",
    ]),
  });
  await expect(page.getByText(filename)).toBeVisible();

  await input.fill("Simulate the production of this module located at 24.1456 N, 54.5318 E. Provide output in peak power, average daily generation, and exergy factor.");
  await input.press("Enter");

  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(/PV|photovoltaic|module|production|generation|exergy|inverter/i).last()).toBeVisible();
  await expect(page.getByText(/COP\/HSPF|heat-pump rating table|heating capacity/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);

  await input.fill("Now scale this up to 1,000,000 of these modules. What power output would that get me and what inverter would you recommend?");
  await input.press("Enter");

  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(/module|power|output|inverter|scale/i).last()).toBeVisible();
  await expect(page.getByText(/COP\/HSPF|heat-pump rating table|heating capacity/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);
});

test("power plant deck completes plant analysis and answers economics follow-up", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI power plant analysis smoke",
      description: "Browser QA for generic power plant analysis and follow-up calculations.",
      goal: "Extract plant performance values and answer sensitivity questions.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  const filename = "natural gas plant investment deck.pdf";
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "Blue Mesa Energy Center",
      "Natural gas combined cycle power plant",
      "Configuration: 2 x F-class gas turbine, HRSG, and one steam turbine.",
      "Net plant output 620 MW",
      "Gross output 655 MW",
      "Net heat rate 6,600 Btu/kWh HHV",
      "Expected capacity factor 65%",
      "Base gas price $4.25/MMBtu",
      "Merchant power price $62/MWh",
      "NOx emissions 9 ppm",
    ]),
  });
  await expect(page.getByText(filename)).toBeVisible();

  await input.fill("Conduct an environmental and economic analysis for this plant.");
  await input.press("Enter");
  await expect(page.getByText(ACTIVE_STATUS_RE).first()).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(/plant|economic|environmental|analysis|capacity|generation|fuel|emissions/i).last()).toBeVisible();
  await expect(page.getByText("Use as a triage note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);

  await input.fill("What if gas is $5/MMBtu and capacity factor is 70%? What does that do to annual generation, fuel cost, spark spread, and CO2?");
  await input.press("Enter");

  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(/annual generation|fuel cost|spark spread|CO2/i).last()).toBeVisible();
  await expect(page.getByText(/Scaled to 5 units/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View Details/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Export Report/i })).toHaveCount(0);
});

test("workspace input hides mode controls and runs uploaded-file analysis on Enter", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI implement smoke",
      description: "Browser QA for fixed implement expert mode.",
      goal: "Run uploaded-file analysis without exposing mode controls.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();
  await expect(page.getByRole("button", { name: /Mode:/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Thinking Level:/i })).toHaveCount(0);

  const filename = "district heat retrofit note.pdf";
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/pdf",
    buffer: pdfBytes([
      "District heat retrofit note",
      "Waste heat source temperature is 88 C with return temperature 52 C.",
      "Available flow is 24 kg/s for 4,800 operating hours per year.",
      "Estimated installed cost is 6.4 million USD and annual maintenance is 180,000 USD.",
      "The file does not include measured seasonal load duration or final interconnection design.",
    ]),
  });
  await expect(page.getByText(filename)).toBeVisible();

  await input.fill("Analyze this file and create a concise decision readout.");
  await input.press("Enter");

  await expect(page.getByText(/6\.4 million USD|88 C|24 kg\/s/i).last()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: /Approve Plan/i })).toHaveCount(0);
  await expect(page.getByText(/View Details|Export Report|Do Not Claim Yet|What Is Supported/i)).toHaveCount(0);
});

test("chat export creates CSV and PDF download links backed by server artifacts", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI export artifact smoke",
      description: "Browser QA for run-owned export artifacts.",
      goal: "Create downloadable exports from saved run context.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  await input.fill("What is exergy?");
  await input.press("Enter");
  await expect(page.getByText(/maximum useful work|useful work potential|work potential|equilibrium with its environment|availability/i).first()).toBeVisible({ timeout: 30_000 });

  await input.fill("Export that answer as CSV and PDF files.");
  await input.press("Enter");
  const csvLink = page.getByRole("link", { name: /Download .*\.csv/i }).last();
  const pdfLink = page.getByRole("link", { name: /Download .*\.pdf/i }).last();
  await expect(csvLink).toBeVisible({ timeout: 60_000 });
  await expect(pdfLink).toBeVisible();

  const csvHref = await csvLink.getAttribute("href");
  const pdfHref = await pdfLink.getAttribute("href");
  expect(csvHref).toBeTruthy();
  expect(pdfHref).toBeTruthy();
  const csvResponse = await request.get(csvHref!);
  const pdfResponse = await request.get(pdfHref!);
  expect(csvResponse.ok()).toBeTruthy();
  expect(pdfResponse.ok()).toBeTruthy();
  expect(csvResponse.headers()["content-type"]).toContain("text/csv");
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
});

test("refresh restores completed run answer and the next prompt stays independent", async ({ page, request }) => {
  const projectResponse = await request.post("/api/projects", {
    data: {
      name: "UI refresh restore smoke",
      description: "Browser QA for durable run restoration.",
      goal: "Restore chat from server-owned run state.",
      domain: "general",
    },
  });
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();

  await page.goto(`/projects/${project.id}`);
  const input = page.locator("textarea").first();
  await expect(input).toBeVisible();

  await input.fill("What is exergy?");
  await input.press("Enter");
  await expect(page.getByText(/maximum useful work|useful work potential|work potential|equilibrium with its environment|availability/i).first()).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText(/maximum useful work|useful work potential|work potential|equilibrium with its environment|availability/i).first()).toBeVisible({ timeout: 30_000 });

  const refreshedInput = page.locator("textarea").first();
  await refreshedInput.fill("What is currently the cheapest solar panel per watt that I can buy online?");
  await refreshedInput.press("Enter");
  await expect(page.getByText(ACTIVE_STATUS_RE)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText(/solar|panel|module|watt|price|USD\/W|per watt/i).last()).toBeVisible();
  await expect(page.getByText(/View Details|Export Report|Detailed View|Key Sources/i)).toHaveCount(0);
});

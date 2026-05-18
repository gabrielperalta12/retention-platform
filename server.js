const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const LOCAL_CSV_FILE = process.env.LOCAL_CSV_FILE || path.join(DATA_DIR, "current.csv");
const LOCAL_CSV_WEEK = process.env.LOCAL_CSV_WEEK || "";

const FIELD_ALIASES = {
  lead_id: ["lead_id", "lead id", "id", "leadid", "customer_id", "account_id"],
  account_name: ["account_name", "account", "company", "company_name", "cliente", "client", "name"],
  kam_name: ["kam", "kam_name", "executive", "ejecutivo", "commercial_executive", "owner", "assigned_to"],
  risk_score: ["risk_score", "score", "churn_score", "churn risk", "probability", "probabilidad"],
  risk_level: ["risk_level", "risk segment", "risk_segment", "churn_level"],
  risk_reason: ["risk_reason", "reason", "driver", "drivers", "churn_reason", "motivo"],
  revenue: ["revenue", "arr", "mrr", "gmv", "value", "valor"],
  segment: ["segment", "segmento", "tier", "customer_segment", "market_segment"],
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

ensureStore();
tryImportLocalCsv();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/state" && req.method === "GET") {
      return json(res, readStore());
    }

    if (url.pathname === "/api/upload" && req.method === "POST") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const csvText = String(payload.csv || "");
      const week = normalizeWeek(payload.week);
      const fileName = String(payload.fileName || "weekly-upload.csv");
      const imported = importCsv(csvText, week, fileName);
      return json(res, imported);
    }

    if (url.pathname === "/api/import-local" && req.method === "POST") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const imported = importLocalCsv(payload.week);
      return json(res, imported);
    }

    if (url.pathname === "/api/action" && req.method === "POST") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const updated = updateAction(payload);
      return json(res, updated);
    }

    if (url.pathname === "/api/week" && req.method === "DELETE") {
      const week = url.searchParams.get("week");
      const store = readStore();
      store.leads = store.leads.filter((lead) => lead.week !== week);
      store.uploads = store.uploads.filter((upload) => upload.week !== week);
      writeStore(store);
      return json(res, store);
    }

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, { error: error.message || "Unexpected server error" }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Retention Monitoring running at http://${HOST}:${PORT}`);
});

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    writeStore({ uploads: [], leads: [] });
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
}

function writeStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 20 * 1024 * 1024) {
        req.destroy(new Error("Upload is too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function normalizeWeek(value) {
  if (value) return String(value).slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function importCsv(csvText, week, fileName) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error("CSV must include a header and at least one row");

  const headers = rows[0].map((header) => header.trim());
  const normalizedHeaders = headers.map(normalizeKey);
  const mappings = mapHeaders(normalizedHeaders);

  if (mappings.lead_id === undefined || mappings.account_name === undefined || mappings.kam_name === undefined) {
    throw new Error("CSV needs columns for lead id, account/company name, and KAM");
  }

  const store = readStore();
  const priorByKey = new Map();
  for (const lead of store.leads) {
    priorByKey.set(`${lead.week}::${lead.lead_id}`, lead);
  }

  const nextLeads = rows.slice(1).map((row, index) => {
    const raw = Object.fromEntries(headers.map((header, idx) => [header, row[idx] || ""]));
    const leadId = pick(row, mappings.lead_id) || `${week}-${index + 1}`;
    const existing = priorByKey.get(`${week}::${leadId}`);
    const score = parseScore(pick(row, mappings.risk_score));
    return {
      id: `${week}::${leadId}`,
      week,
      lead_id: leadId,
      account_name: pick(row, mappings.account_name),
      kam_name: pick(row, mappings.kam_name),
      risk_score: score,
      risk_level: riskLevel(score, pick(row, mappings.risk_level)),
      risk_reason: pick(row, mappings.risk_reason),
      revenue: parseNumber(pick(row, mappings.revenue)),
      segment: pick(row, mappings.segment),
      status: existing?.status || "New",
      action_taken: existing?.action_taken || "",
      notes: existing?.notes || "",
      next_follow_up: existing?.next_follow_up || "",
      outcome: existing?.outcome || "",
      updated_at: existing?.updated_at || "",
      raw,
    };
  }).filter((lead) => lead.account_name || lead.lead_id);

  store.leads = store.leads.filter((lead) => lead.week !== week).concat(nextLeads);
  store.uploads = store.uploads.filter((upload) => upload.week !== week).concat({
    week,
    fileName,
    rows: nextLeads.length,
    uploaded_at: new Date().toISOString(),
  });

  writeStore(store);
  return store;
}

function tryImportLocalCsv() {
  if (!fs.existsSync(LOCAL_CSV_FILE)) return;

  try {
    importLocalCsv(LOCAL_CSV_WEEK);
    console.log(`Imported local CSV from ${LOCAL_CSV_FILE}`);
  } catch (error) {
    console.warn(`Could not import local CSV: ${error.message}`);
  }
}

function importLocalCsv(weekOverride) {
  if (!fs.existsSync(LOCAL_CSV_FILE)) {
    throw new Error(`Local CSV not found at ${LOCAL_CSV_FILE}`);
  }

  const csvText = fs.readFileSync(LOCAL_CSV_FILE, "utf8");
  const week = normalizeWeek(weekOverride || LOCAL_CSV_WEEK || fileDate(LOCAL_CSV_FILE));
  return importCsv(csvText, week, path.basename(LOCAL_CSV_FILE));
}

function fileDate(filePath) {
  return fs.statSync(filePath).mtime.toISOString().slice(0, 10);
}

function updateAction(payload) {
  const store = readStore();
  const lead = store.leads.find((item) => item.id === payload.id);
  if (!lead) throw new Error("Lead not found");

  lead.status = String(payload.status || lead.status || "New");
  lead.action_taken = String(payload.action_taken || "");
  lead.notes = String(payload.notes || "");
  lead.next_follow_up = String(payload.next_follow_up || "");
  lead.outcome = String(payload.outcome || "");
  lead.updated_at = new Date().toISOString();

  writeStore(store);
  return store;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && insideQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function mapHeaders(headers) {
  const mappings = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const aliasKeys = aliases.map(normalizeKey);
    const index = headers.findIndex((header) => aliasKeys.includes(header));
    if (index >= 0) mappings[field] = index;
  }
  return mappings;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function pick(row, index) {
  if (index === undefined) return "";
  return String(row[index] || "").trim();
}

function parseScore(value) {
  const number = parseNumber(value);
  if (number > 1) return Math.min(number / 100, 1);
  return Math.max(number, 0);
}

function parseNumber(value) {
  const cleaned = String(value || "").replace(/[%$,\s]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function riskLevel(score, fallback) {
  const given = String(fallback || "").trim();
  if (given && Number.isNaN(Number(given))) return given;
  if (score >= 0.8) return "Critical";
  if (score >= 0.6) return "High";
  if (score >= 0.35) return "Medium";
  return "Low";
}

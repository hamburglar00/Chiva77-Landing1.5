import { CONFIG_SHEETS } from '../credenciales/google-sheets.js';

// =========================
// ✅ CONFIG (TODO LO EDITABLE ARRIBA)
// =========================
const GEO = {
  ENABLED: true,

  // 1) Headers de plataforma (Vercel) -> 0ms extra
  USE_VERCEL_GEO_HEADERS: true,

  // 2) Fallback a proveedor por IP (server-side)
  PROVIDER: "ipapi", // "ipapi" | "ipwhois"

  // timeout total del fetch geo
  TIMEOUT_MS: 1200,

  // cache en memoria (serverless: puede persistir un rato, no garantizado)
  CACHE_TTL_MS: 6 * 60 * 60 * 1000, // 6h
};

// Cache simple in-memory por IP
const GEO_CACHE = new Map(); // ip -> { ts, geo: { city, region, country } }

function nowMs() { return Date.now(); }

function isPrivateOrInvalidIp(ip) {
  if (!ip) return true;
  const v = String(ip);

  // IPv6 loopback / localhost
  if (v === "::1") return true;
  if (v.startsWith("::ffff:127.")) return true;

  // IPv4 private ranges
  if (v.startsWith("10.")) return true;
  if (v.startsWith("192.168.")) return true;

  // 172.16.0.0 – 172.31.255.255 (mejor check por prefijo simple)
  if (v.startsWith("172.")) return true;

  // localhost
  if (v.startsWith("127.")) return true;

  // algunas variantes IPv6 mapeadas
  if (v.startsWith("::ffff:192.168.")) return true;
  if (v.startsWith("::ffff:10.")) return true;

  return false;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const socketIp = req.socket?.remoteAddress;

  let rawIp = forwarded?.split(",")[0]?.trim() || socketIp || "";

  // normalizar localhost
  if (rawIp === "::1" || rawIp?.startsWith("::ffff:127.")) rawIp = "";

  // si no es pública, la vaciamos
  if (isPrivateOrInvalidIp(rawIp)) return "";

  return rawIp;
}

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

// 0ms extra: geo directo por headers (si Vercel lo provee)
function getGeoFromVercelHeaders(req) {
  // Vercel suele enviar:
  // x-vercel-ip-country, x-vercel-ip-country-region, x-vercel-ip-city
  const country = req.headers["x-vercel-ip-country"] || "";
  const region  = req.headers["x-vercel-ip-country-region"] || "";
  const city    = req.headers["x-vercel-ip-city"] || "";

  // Algunos proxies usan otras keys (por las dudas)
  const cfCountry = req.headers["cf-ipcountry"] || "";

  const finalCountry = String(country || cfCountry || "").trim();
  const finalRegion  = String(region || "").trim();
  const finalCity    = String(city || "").trim();

  if (!finalCountry && !finalRegion && !finalCity) return null;

  return {
    geo_country: finalCountry || "",
    geo_region: finalRegion || "",
    geo_city: finalCity || "",
    geo_source: "vercel_headers",
  };
}

async function getGeoByIp(ip) {
  if (!GEO.ENABLED) return null;
  if (!ip || isPrivateOrInvalidIp(ip)) return null;

  // cache
  const cached = GEO_CACHE.get(ip);
  if (cached && (nowMs() - cached.ts) < GEO.CACHE_TTL_MS) {
    return { ...cached.geo, geo_source: "cache" };
  }

  try {
    let url = "";
    if (GEO.PROVIDER === "ipwhois") {
      // ipwho.is -> { success, country_code, region, city }
      url = `https://ipwho.is/${encodeURIComponent(ip)}`;
      const r = await fetchWithTimeout(url, GEO.TIMEOUT_MS);
      if (!r.ok) throw new Error(`geo_http_${r.status}`);
      const j = await r.json();

      if (j?.success === false) throw new Error(`geo_fail_${j?.message || "unknown"}`);

      const geo = {
        geo_country: String(j?.country_code || j?.country || "").trim(),
        geo_region: String(j?.region || "").trim(),
        geo_city: String(j?.city || "").trim(),
      };

      // guardar
      GEO_CACHE.set(ip, { ts: nowMs(), geo });
      return { ...geo, geo_source: "ipwhois" };
    }

    // default: ipapi.co -> /<ip>/json/  { country, region, city }
    url = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
    const r = await fetchWithTimeout(url, GEO.TIMEOUT_MS);
    if (!r.ok) throw new Error(`geo_http_${r.status}`);
    const j = await r.json();

    const geo = {
      geo_country: String(j?.country || j?.country_code || "").trim(),
      geo_region: String(j?.region || j?.region_code || "").trim(),
      geo_city: String(j?.city || "").trim(),
    };

    GEO_CACHE.set(ip, { ts: nowMs(), geo });
    return { ...geo, geo_source: "ipapi" };
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    res.setHeader("Access-Control-Allow-Origin", "*");

    // =========================
    // ✅ IP + UA (igual que antes)
    // =========================
    const clientIp = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";

    // =========================
    // ✅ Body (igual que antes)
    // =========================
    const {
      event_source_url,
      fbp,
      fbc,
      email,
      phone,
      fn,
      ln,
      zip,
      ct,
      st,
      country,
      event_id,
      external_id,
      utm_campaign,
      event_time,
      telefono_asignado,
      device_type,

      // geo que manda el front (a veces viene vacío por timeout/adblock)
      geo_city,
      geo_region,
      geo_country,

      promo_code,
    } = req.body || {};

    if (!event_id && !phone && !email) {
      return res.status(400).json({ error: "Faltan datos mínimos (event_id / phone / email)." });
    }

    // =========================
    // ✅ GEO EN BACKEND (NUEVO)
    // Prioridad:
    // 1) geo del frontend si vino completo
    // 2) headers Vercel (0ms)
    // 3) lookup por IP (timeout corto)
    // =========================
    let finalGeoCity = String(geo_city || "").trim();
    let finalGeoRegion = String(geo_region || "").trim();
    let finalGeoCountry = String(geo_country || "").trim();
    let geo_source = "";

    const frontHasAnyGeo = !!(finalGeoCity || finalGeoRegion || finalGeoCountry);

    if (!frontHasAnyGeo && GEO.USE_VERCEL_GEO_HEADERS) {
      const h = getGeoFromVercelHeaders(req);
      if (h) {
        finalGeoCity = h.geo_city;
        finalGeoRegion = h.geo_region;
        finalGeoCountry = h.geo_country;
        geo_source = h.geo_source;
      }
    }

    // si sigue vacío -> intentar por IP
    if (!finalGeoCity && !finalGeoRegion && !finalGeoCountry) {
      const g = await getGeoByIp(clientIp);
      if (g) {
        finalGeoCity = g.geo_city || "";
        finalGeoRegion = g.geo_region || "";
        finalGeoCountry = g.geo_country || "";
        geo_source = g.geo_source || "ip_lookup";
      }
    } else {
      geo_source = "frontend";
    }

    // =========================
    // ✅ Payload a Sheets (igual + geo robusta)
    // =========================
    const sheetPayload = {
      timestamp: new Date().toISOString(),
      phone: phone || "",
      email: email || "",
      fn: fn || "",
      ln: ln || "",
      ct: ct || "",
      st: st || "",
      zip: zip || "",
      country: country || "",
      fbp: fbp || "",
      fbc: fbc || "",
      event_id: event_id || "",
      clientIP: clientIp,
      agentuser: userAgent,
      estado: "",
      valor: "",
      estado_envio: "",
      observaciones: "",
      external_id: external_id || "",
      utm_campaign: utm_campaign || "",
      event_source_url: event_source_url || "",
      event_time: event_time || Math.floor(Date.now() / 1000),
      telefono_asignado: telefono_asignado || "",
      device_type: device_type || "",

      // ✅ ahora salen del backend (si el front falló)
      geo_city: finalGeoCity || "",
      geo_region: finalGeoRegion || "",
      geo_country: finalGeoCountry || "",

      // (opcional) te sirve para debug (si no querés, borrala)
      geo_source: geo_source || "",

      promo_code: promo_code || "",
    };

    const gsRes = await fetch(CONFIG_SHEETS.GOOGLE_SHEETS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sheetPayload),
    });

    const responseText = await gsRes.text();

    if (!gsRes.ok) {
      console.error("❌ Error desde Google Sheets:", responseText);
      return res.status(502).json({ error: "Sheets error", details: responseText });
    }

    console.log("✅ Registrado en Google Sheets:", responseText);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("❌ Error interno:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

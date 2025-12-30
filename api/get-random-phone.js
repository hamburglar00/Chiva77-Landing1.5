// /api/get-random-phone.js
// ✅ Devuelve 1 número listo para usar en wa.me
// ✅ Plan A/B/C/D
// ✅ Flag simple: SOLO ADS o ADS+NORMAL

/**************************************************************
 * ✅ CONFIG (EDITAR SOLO ESTO)
 **************************************************************/

const CONFIG = {
  AGENCIES: [{ id: 17, name: "Geraldina" }],
  BRAND_NAME: "Geraldina",

  // Si querés minimizar fallback, ponelo en false:
  // false => ADS primero, si no hay ADS usa NORMAL
  ONLY_ADS_WHATSAPP: true,

  SUPPORT_FALLBACK_ENABLED: true,
  SUPPORT_FALLBACK_NUMBER: "5491169789243",

  // Más realista para serverless + upstream
  TIMEOUT_MS: 2500,
  MAX_RETRIES: 2,

  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
};

let LAST_GOOD_NUMBER = null;
let LAST_GOOD_META = null;

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function normalizePhone(raw) {
  let phone = String(raw || "").replace(/\D+/g, "");
  if (phone.length === 10) phone = "54" + phone;
  if (!phone || phone.length < 8) return null;
  return phone;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
      signal: ctrl.signal,
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.http_status = res.status;
      err.ms = ms;
      throw err;
    }
    const json = await res.json();
    return { json, ms, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const mode = String(req.query.mode || "normal").toLowerCase();

  try {
    const agency = CONFIG.AGENCIES[Math.floor(Math.random() * CONFIG.AGENCIES.length)];
    if (!agency?.id) throw new Error("No hay agencies configuradas");

    const API_URL = `${CONFIG.UPSTREAM_BASE}/agency/${agency.id}/random-contact`;

    // Plan A: upstream con retries
    let data = null;
    let upstreamMeta = { attempts: 0, last_error: null, ms: null, status: null };

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES && !data; attempt++) {
      upstreamMeta.attempts = attempt;
      try {
        const r = await fetchJsonWithTimeout(API_URL, CONFIG.TIMEOUT_MS);
        data = r.json;
        upstreamMeta.ms = r.ms;
        upstreamMeta.status = r.status;
      } catch (e) {
        upstreamMeta.last_error = e?.message || "unknown";
        upstreamMeta.status = e?.http_status || null;
      }
    }

    if (!data) {
      throw new Error(`Upstream fail: ${upstreamMeta.last_error || "unknown"}`);
    }

    // Plan B: elegir número
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];
    const normalList = Array.isArray(data?.whatsapp) ? data.whatsapp : [];

    let rawPhone = null;
    let chosenSource = null;

    if (CONFIG.ONLY_ADS_WHATSAPP) {
      if (!adsList.length) throw new Error("ONLY_ADS_WHATSAPP activo y ads.whatsapp vacío");
      rawPhone = pickRandom(adsList);
      chosenSource = "ads.whatsapp";
    } else {
      // ADS primero, después normal
      if (adsList.length) {
        rawPhone = pickRandom(adsList);
        chosenSource = "ads.whatsapp";
      } else if (normalList.length) {
        rawPhone = pickRandom(normalList);
        chosenSource = "whatsapp";
      } else {
        throw new Error("Sin números disponibles (ads + normal)");
      }
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) throw new Error(`Número inválido desde ${chosenSource}`);

    // Plan C: cache “último bueno”
    LAST_GOOD_NUMBER = phone;
    LAST_GOOD_META = {
      agency_id: agency.id,
      source: chosenSource,
      only_ads: CONFIG.ONLY_ADS_WHATSAPP,
      ts: new Date().toISOString(),
      upstream: upstreamMeta,
      ads_len: adsList.length,
      normal_len: normalList.length,
    };

    return res.status(200).json({
      number: phone,
      name: mode === "ads" ? `${CONFIG.BRAND_NAME}_ADS` : CONFIG.BRAND_NAME,
      weight: 1,
      mode,
      agency_id: agency.id,
      chosen_from: chosenSource,
      only_ads: CONFIG.ONLY_ADS_WHATSAPP,
      ms: Date.now() - startedAt,
      upstream: upstreamMeta,
    });
  } catch (err) {
    // Plan C respuesta: último bueno si existe
    if (LAST_GOOD_NUMBER && String(LAST_GOOD_NUMBER).length >= 8) {
      return res.status(200).json({
        number: LAST_GOOD_NUMBER,
        name: "LastGoodCache",
        weight: 1,
        mode,
        cache: true,
        last_good_meta: LAST_GOOD_META || null,
        error: err?.message || "unknown_error",
        ms: Date.now() - startedAt,
      });
    }

    // Plan D: soporte
    if (CONFIG.SUPPORT_FALLBACK_ENABLED) {
      return res.status(200).json({
        number: CONFIG.SUPPORT_FALLBACK_NUMBER,
        name: "SupportFallback",
        weight: 1,
        mode,
        fallback: true,
        error: err?.message || "unknown_error",
        ms: Date.now() - startedAt,
      });
    }

    return res.status(503).json({
      error: "NO_NUMBER_AVAILABLE",
      mode,
      details: err?.message || "unknown_error",
      ms: Date.now() - startedAt,
    });
  }
}


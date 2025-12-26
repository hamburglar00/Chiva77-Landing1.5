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

  // 🔥 FLAG PRINCIPAL:
  // true  => SOLO usa data.ads.whatsapp
  // false => usa data.ads.whatsapp y si está vacío, usa data.whatsapp
  ONLY_ADS_WHATSAPP: true,

  // ✅ soporte controlado por flag
  SUPPORT_FALLBACK_ENABLED: true, // ponelo false cuando ya estés seguro
  SUPPORT_FALLBACK_NUMBER: "5491169789243",

  // ✅ timeout / retries (prioridad: contacto)
  TIMEOUT_MS: 2000,
  MAX_RETRIES: 2,

  // Upstream (API externa)
  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
};
/*************************************************************/

let LAST_GOOD_NUMBER = null;
let LAST_GOOD_META = null;

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function normalizePhone(raw) {
  let phone = String(raw || "").replace(/\D+/g, "");
  if (phone.length === 10) phone = "54" + phone; // AR
  if (!phone || phone.length < 8) return null;
  return phone;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  const startedAt = Date.now();

  // ✅ Cache-control fuerte (evita caches raros)
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const mode = String(req.query.mode || "normal").toLowerCase();

  try {
    // 1️⃣ Elegimos agency al azar
    const agency = CONFIG.AGENCIES[Math.floor(Math.random() * CONFIG.AGENCIES.length)];
    if (!agency?.id) throw new Error("No hay agencies configuradas");

    const API_URL = `${CONFIG.UPSTREAM_BASE}/agency/${agency.id}/random-contact`;

    // ============================================================
    // ✅ Plan A: llamar upstream con timeout + retries
    // ============================================================
    let data = null;
    let lastFetchError = null;

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES && !data; attempt++) {
      try {
        data = await fetchJsonWithTimeout(API_URL, CONFIG.TIMEOUT_MS);
      } catch (e) {
        lastFetchError = e;
      }
    }

    if (!data) {
      throw new Error(`Upstream fail: ${lastFetchError?.message || "unknown"}`);
    }

    // ============================================================
    // ✅ Plan B: elegir número según FLAG
    // ============================================================
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];
    const normalList = Array.isArray(data?.whatsapp) ? data.whatsapp : [];

    let rawPhone = null;
    let chosenSource = null;

    if (CONFIG.ONLY_ADS_WHATSAPP) {
      // 🚨 SOLO ADS
      if (!adsList.length) {
        throw new Error("ONLY_ADS_WHATSAPP activo y ads.whatsapp vacío");
      }
      rawPhone = pickRandom(adsList);
      chosenSource = "ads.whatsapp";
    } else {
      // ✅ ADS primero, luego NORMAL
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

    // ============================================================
    // ✅ Plan C (server): guardar “último bueno” en memoria
    // (en serverless puede persistir, pero NO es garantizado)
    // ============================================================
    LAST_GOOD_NUMBER = phone;
    LAST_GOOD_META = {
      agency_id: agency.id,
      source: chosenSource,
      only_ads: CONFIG.ONLY_ADS_WHATSAPP,
      ts: new Date().toISOString(),
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
    });
  } catch (err) {
    // ============================================================
    // ✅ Plan C (respuesta): si existe “último bueno”, devolverlo
    // ============================================================
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

    // ============================================================
    // ✅ Plan D: soporte SOLO si flag ON, si no -> 503 real
    // ============================================================
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

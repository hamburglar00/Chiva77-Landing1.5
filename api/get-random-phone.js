// /api/get-random-phone.js
// Objetivo: devolver SIEMPRE un número rápido, con planes A/B/C/D claros.
//
// Plan A) Upstream OK → número desde ads.whatsapp (prioridad) o whatsapp
// Plan B) Retry rápido (por si el upstream “titubea”)
// Plan C) Si falla upstream → LAST_GOOD_NUMBER (cache en memoria de la instancia)
// Plan D) Si NO hay last-good → fallback de soporte (flag on/off). Si flag off → 503

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

  // ✅ anti-cache (rápido + consistente)
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  /************ CONFIG POR LANDING ************/
  const AGENCIES = [{ id: 17, name: "Geraldina" }];
  const BRAND_NAME = "Geraldina";

  // Plan D (flag): soporte
  const SUPPORT_FALLBACK_ENABLED = true; // <- ponelo false cuando quieras “cero soporte”
  const SUPPORT_FALLBACK_NUMBER = "5491169789243";

  // Plan B: reintentos rápidos (prioridad: velocidad)
  const TIMEOUT_MS = 1200; // ⏱️ timeout por intento
  const MAX_RETRIES = 2;   // 🔁 reintentos
  /*******************************************/

  const mode = String(req.query.mode || "normal").toLowerCase();

  try {
    // 1) Elegimos agency al azar
    const agency = AGENCIES[Math.floor(Math.random() * AGENCIES.length)];
    if (!agency?.id) throw new Error("No hay agencies configuradas");

    const API_URL = `https://api.asesadmin.com/api/v1/agency/${agency.id}/random-contact`;

    // =========================
    // Plan A + Plan B
    // =========================
    // A) Pedimos al upstream (asesadmin) el JSON
    // B) Si falla, reintentamos rápido
    let data = null;
    let lastFetchError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES && !data; attempt++) {
      try {
        data = await fetchJsonWithTimeout(API_URL, TIMEOUT_MS);
      } catch (e) {
        lastFetchError = e;
      }
    }

    if (!data) {
      throw new Error(`Upstream fail: ${lastFetchError?.message || "unknown"}`);
    }

    // Jerarquía pedida:
    // 1) ads.whatsapp
    // 2) whatsapp
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];
    const normalList = Array.isArray(data?.whatsapp) ? data.whatsapp : [];

    let chosenSource = null;
    let rawPhone = null;

    if (adsList.length > 0) {
      rawPhone = pickRandom(adsList);
      chosenSource = "ads.whatsapp";
    } else if (normalList.length > 0) {
      rawPhone = pickRandom(normalList);
      chosenSource = "whatsapp";
    } else {
      throw new Error("Listas vacías: ads.whatsapp y whatsapp");
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) throw new Error(`Número inválido desde ${chosenSource}`);

    // =========================
    // Plan C (LAST GOOD)
    // =========================
    // Guardamos “último bueno” para rescatar cuando el upstream falle.
    // Nota: en serverless NO es persistente garantizado; dura lo que viva la instancia.
    LAST_GOOD_NUMBER = phone;
    LAST_GOOD_META = {
      agency_id: agency.id,
      source: chosenSource,
      ts: new Date().toISOString(),
    };

    // ✅ Respuesta OK (A)
    return res.status(200).json({
      number: phone,
      name: mode === "ads" ? `${BRAND_NAME}_ADS` : BRAND_NAME,
      weight: 1,
      mode,
      agency_id: agency.id,
      chosen_from: chosenSource,
      plan_used: "A",
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    // =========================
    // Plan C (LAST GOOD)
    // =========================
    if (LAST_GOOD_NUMBER && String(LAST_GOOD_NUMBER).length >= 8) {
      return res.status(200).json({
        number: LAST_GOOD_NUMBER,
        name: "LastGoodCache",
        weight: 1,
        mode,
        cache: true,
        last_good_meta: LAST_GOOD_META || null,
        error: err?.message || "unknown_error",
        plan_used: "C",
        ms: Date.now() - startedAt,
      });
    }

    // =========================
    // Plan D (SOPORTE, con flag)
    // =========================
    if (SUPPORT_FALLBACK_ENABLED) {
      return res.status(200).json({
        number: SUPPORT_FALLBACK_NUMBER,
        name: "SupportFallback",
        weight: 1,
        mode,
        fallback: true,
        error: err?.message || "unknown_error",
        plan_used: "D",
        ms: Date.now() - startedAt,
      });
    }

    // Si soporte está apagado y no hay last-good, devolvemos 503 real
    return res.status(503).json({
      error: "NO_NUMBER_AVAILABLE",
      mode,
      details: err?.message || "unknown_error",
      plan_used: "NONE",
      ms: Date.now() - startedAt,
    });
  }
}

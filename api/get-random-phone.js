// /api/get-random-phone.js

// ✅ Cache en memoria: último número válido entregado por ESTA API
// (en serverless puede persistir, pero no es 100% garantizado)
let LAST_GOOD_NUMBER = null;
let LAST_GOOD_META = null;

export default async function handler(req, res) {
  const startedAt = Date.now();

  try {
    /************ CONFIG POR LANDING ************/
    const AGENCIES = [{ id: 17, name: "Geraldina" }];

    const BRAND_NAME = "Geraldina";
    const FALLBACK_ADS = "5491169789243";
    const FALLBACK_NORMAL = "5491169789243";

    const TIMEOUT_MS = 5000; // ⏱️ timeout real
    const MAX_RETRIES = 2;   // 🔁 reintentos
    /*******************************************/

    const mode = String(req.query.mode || "normal").toLowerCase();

    // 1️⃣ Elegimos agency al azar
    const agency = AGENCIES[Math.floor(Math.random() * AGENCIES.length)];
    if (!agency?.id) throw new Error("No hay agencies configuradas");

    const API_URL = `https://api.asesadmin.com/api/v1/agency/${agency.id}/random-contact`;

    // 2️⃣ Fetch con timeout + retry
    let data = null;
    let lastFetchError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES && !data; attempt++) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

        const response = await fetch(API_URL, {
          headers: { "Cache-Control": "no-store" },
          signal: ctrl.signal,
        });

        clearTimeout(t);

        if (!response.ok) throw new Error(`Error HTTP ${response.status}`);
        data = await response.json();
      } catch (e) {
        lastFetchError = e;
      }
    }

    if (!data) {
      throw new Error(
        `No se pudo obtener data de api. Último error: ${lastFetchError?.message || "unknown"}`
      );
    }

    // 3️⃣ Jerarquía pedida:
    //    A) ads.whatsapp
    //    B) whatsapp
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];
    const normalList = Array.isArray(data?.whatsapp) ? data.whatsapp : [];

    const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

    let chosenSource = null;
    let rawPhone = null;

    if (adsList.length > 0) {
      rawPhone = pickRandom(adsList);
      chosenSource = "ads.whatsapp";
    } else if (normalList.length > 0) {
      rawPhone = pickRandom(normalList);
      chosenSource = "whatsapp";
    } else {
      // 4️⃣ Si ambas listas vienen vacías → forzamos error para entrar al catch
      throw new Error("Listas vacías: ads.whatsapp y whatsapp");
    }

    // 5️⃣ Normalizar número
    let phone = String(rawPhone || "").replace(/\D+/g, "");
    if (phone.length === 10) phone = "54" + phone;

    if (!phone || phone.length < 8) {
      throw new Error(`Número inválido desde ${chosenSource}`);
    }

    // ✅ Guardamos “último bueno” (plan C)
    LAST_GOOD_NUMBER = phone;
    LAST_GOOD_META = {
      agency_id: agency.id,
      source: chosenSource,
      ts: new Date().toISOString(),
    };

    res.setHeader("Cache-Control", "no-store, max-age=0");

    return res.status(200).json({
      number: phone,
      name: mode === "ads" ? `${BRAND_NAME}_ADS` : BRAND_NAME,
      weight: 1,
      mode,
      agency_id: agency.id,

      // info útil (podés borrar si no querés)
      chosen_from: chosenSource,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    const mode = String(req.query.mode || "normal").toLowerCase();

    // 6️⃣ Plan C: si existe último número bueno, lo devolvemos ANTES del fallback
    if (LAST_GOOD_NUMBER && String(LAST_GOOD_NUMBER).length >= 8) {
      res.setHeader("Cache-Control", "no-store, max-age=0");

      return res.status(200).json({
        number: LAST_GOOD_NUMBER,
        name: "LastGoodCache",
        weight: 1,
        mode,

        cache: true,
        last_good_meta: LAST_GOOD_META || null,
        error: err?.message || "unknown_error",
      });
    }

    // 7️⃣ Plan D: recién acá fallback hardcodeado
    res.setHeader("Cache-Control", "no-store, max-age=0");

    return res.status(200).json({
      number: mode === "ads" ? FALLBACK_ADS : FALLBACK_NORMAL,
      name: "Fallback",
      weight: 1,
      mode,
      fallback: true,
      error: err?.message || "unknown_error",
    });
  }
}

// /api/get-random-phone.js
export default async function handler(req, res) {
  try {
    /************ CONFIG POR LANDING ************/
    const AGENCIES = [
      { id: 17, name: "Geraldina" }, // hoy una sola, mañana varias
      // { id: 18, name: "OtraAgency" },
    ];

    const BRAND_NAME = "Geraldina";          // ← cambiar si querés
    const FALLBACK_ADS = "5491169789243";    // ← cambiar si querés
    const FALLBACK_NORMAL = "5491169789243"; // ← cambiar si querés
    /*******************************************/

    const mode = String(req.query.mode || "normal").toLowerCase();

    // 1️⃣ Elegimos agency al azar
    const agency =
      AGENCIES[Math.floor(Math.random() * AGENCIES.length)];

    if (!agency?.id) {
      throw new Error("No hay agencies configuradas");
    }

    const API_URL = `https://api.asesadmin.com/api/v1/agency/${agency.id}/random-contact`;

    const response = await fetch(API_URL, {
      headers: { "Cache-Control": "no-store" },
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();

    // 2️⃣ Elegimos lista según modo
    const list =
      mode === "ads"
        ? (data?.ads?.whatsapp || [])
        : (data?.whatsapp || []);

    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`No hay números disponibles para mode=${mode}`);
    }

    // 3️⃣ Elegimos número al azar
    let phone = String(
      list[Math.floor(Math.random() * list.length)] || ""
    ).replace(/\D+/g, "");

    // Normalización AR básica
    if (phone.length === 10) phone = "54" + phone;
    if (!phone || phone.length < 8) {
      throw new Error("Número inválido");
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");

    return res.status(200).json({
      number: phone,
      name: mode === "ads"
        ? `${BRAND_NAME}_ADS`
        : BRAND_NAME,
      weight: 1,
      mode,
      agency_id: agency.id,
    });

  } catch (err) {
    const mode = String(req.query.mode || "normal").toLowerCase();

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

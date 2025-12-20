// /api/get-random-phone.js
export default async function handler(req, res) {
  try {
    /************ CONFIG POR LANDING ************/
    const AGENCY_ID = 17;               // ← cambiar
    const BRAND_NAME = "Geraldina";     // ← cambiar
    const FALLBACK_ADS = "5491169789243";     // ← cambiar
    const FALLBACK_NORMAL = "5491169789243";  // ← cambiar
    /*******************************************/

    const mode = String(req.query.mode || "normal").toLowerCase();
    const API_URL = `https://api.asesadmin.com/api/v1/agency/${AGENCY_ID}/random-contact`;

    const response = await fetch(API_URL, {
      headers: { "Cache-Control": "no-store" },
    });

    if (!response.ok) throw new Error(`Error HTTP ${response.status}`);

    const data = await response.json();

    const list = mode === "ads"
      ? (data?.ads?.whatsapp || [])
      : (data?.whatsapp || []);

    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`No hay números disponibles para mode=${mode}`);
    }

    let phone = String(list[Math.floor(Math.random() * list.length)] || "").replace(/\D+/g, "");
    if (phone.length === 10) phone = "54" + phone;
    if (!phone || phone.length < 8) throw new Error("Número inválido");

    res.setHeader("Cache-Control", "no-store, max-age=0");

    return res.status(200).json({
      number: phone,
      name: mode === "ads" ? `${BRAND_NAME}_ADS` : BRAND_NAME,
      weight: 1,
      mode,
    });

  } catch (err) {
    const mode = String(req.query.mode || "normal").toLowerCase();

    return res.status(200).json({
      number: mode === "ads" ? FALLBACK_ADS : FALLBACK_NORMAL,
      name: "Fallback",
      weight: 1,
      mode,
      fallback: true,
      error: err?.message,
    });
  }
}

// /api/get-random-phone.js
export default async function handler(req, res) {
  try {
    const AGENCIES = [
      { id: 111, name: "Gera" }
    ];

    const randomAgency = AGENCIES[Math.floor(Math.random() * AGENCIES.length)];
    const API_URL = `https://api.asesadmin.com/api/v1/agency/${randomAgency.id}/random-phone`;

    // 🔁 Intentamos hasta 2 veces
    let phone = null, lastError = null;

    for (let attempt = 1; attempt <= 2 && !phone; attempt++) {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000); // 5 segundos
        const response = await fetch(API_URL, {
          headers: { "Cache-Control": "no-store" },
          signal: ctrl.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        phone =
          data?.phone_number ||
          data?.phone ||
          data?.number ||
          data?.data?.number ||
          data?.data?.phone ||
          data?.data?.phone_number ||
          null;

        if (phone) phone = String(phone).replace(/\D/g, "");
        if (!phone || phone.length < 8) throw new Error("Número inválido");
      } catch (err) {
        lastError = err;
        console.warn(`Intento ${attempt} fallido:`, err.message);
        await new Promise(r => setTimeout(r, 200)); // pequeño delay antes del retry
      }
    }

    if (!phone) throw lastError || new Error("No se obtuvo número válido");

    // ✅ Éxito
    return res.status(200).json({
      number: phone,
      name: randomAgency.name,
      agency_id: randomAgency.id,
      weight: 1,
    });

  } catch (err) {
    console.error("❌ Error al obtener número:", err.message);
    return res.status(200).json({
      number: "5491169789243",
      name: "Soporte Gera",
      agency_id: "fallback",
      weight: 1,
    });
  }
}

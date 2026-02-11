// /api/phones-pool.js
// Devuelve pool de números ADS (array) y se cachea en Vercel/CDN

const CONFIG = {
  AGENCY_ID: 17,
  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
  TIMEOUT_MS: 2500,

  // Cache global (CDN):
  // 900s = 15 min fresh
  // 300s = sirve stale mientras revalida (mejor UX)
  S_MAXAGE: 900,
  SWR: 300,
};

function normalizePhone(raw) {
  let phone = String(raw || "").replace(/\D+/g, "");
  if (phone.length === 10) phone = "54" + phone;
  if (!/^\d{8,17}$/.test(phone)) return null;
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
  try {
    // ✅ Cache CDN en Vercel
    res.setHeader(
      "Cache-Control",
      `public, s-maxage=${CONFIG.S_MAXAGE}, stale-while-revalidate=${CONFIG.SWR}`
    );

    const url = `${CONFIG.UPSTREAM_BASE}/agency/${CONFIG.AGENCY_ID}/random-contact`;
    const data = await fetchJsonWithTimeout(url, CONFIG.TIMEOUT_MS);

    // Tu upstream ya trae ads.whatsapp
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];

    const numbers = adsList
      .map(normalizePhone)
      .filter(Boolean);

    if (!numbers.length) {
      return res.status(503).json({ error: "NO_ADS_NUMBERS", numbers: [] });
    }

    // opcional: dedupe
    const deduped = [...new Set(numbers)];

    return res.status(200).json({
      numbers: deduped,
      count: deduped.length,
      ts: new Date().toISOString(),
      agency_id: CONFIG.AGENCY_ID,
    });
  } catch (e) {
    return res.status(503).json({
      error: "UPSTREAM_FAIL",
      message: String(e?.message || e),
      numbers: [],
    });
  }
}

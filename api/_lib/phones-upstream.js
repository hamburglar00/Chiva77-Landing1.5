/**
 * Lógica compartida: obtener números desde ases (upstream)
 */

export const UPSTREAM_CONFIG = {
  AGENCY_ID: 17,
  UPSTREAM_BASE: "https://api.asesadmin.com/api/v1",
  TIMEOUT_MS: 2500,
};

export function normalizePhone(raw) {
  let phone = String(raw || "").replace(/\D+/g, "");
  if (phone.length === 10) phone = "54" + phone;
  if (!/^\d{8,17}$/.test(phone)) return null;
  return phone;
}

export async function fetchNumbersFromAses() {
  const url = `${UPSTREAM_CONFIG.UPSTREAM_BASE}/agency/${UPSTREAM_CONFIG.AGENCY_ID}/random-contact`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_CONFIG.TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];
    const numbers = adsList.map(normalizePhone).filter(Boolean);
    const deduped = [...new Set(numbers)];
    return {
      numbers: deduped,
      count: deduped.length,
      ts: new Date().toISOString(),
      agency_id: UPSTREAM_CONFIG.AGENCY_ID,
    };
  } finally {
    clearTimeout(t);
  }
}

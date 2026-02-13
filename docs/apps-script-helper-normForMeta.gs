/**
 * ============================================================
 * FUNCIÓN A AGREGAR EN TU APPS SCRIPT (antes de hash())
 * ============================================================
 * Copiá esta función en la sección de Helpers de tu Apps Script.
 */

/**
 * Normalización para Meta CAPI (mejora Event Match Quality)
 * - Ciudad (ct) y Estado (st): lowercase, sin espacios ni puntuación
 * - País: ISO 3166-1 alpha-2 (2 letras)
 * - Zip (zp): solo dígitos
 * @param {string} value - Valor a normalizar
 * @param {string} type - "ct" | "country" | "zp"
 * @returns {string} Valor normalizado
 */
function normForMeta(value, type) {
  if (!value || String(value).trim() === "") return "";
  const v = String(value).trim().toLowerCase();
  if (type === "ct") {
    return v.replace(/[\s\p{P}\p{S}]/gu, "");
  }
  if (type === "country") {
    const countryMap = {
      "argentina": "ar", "ar": "ar",
      "estados unidos": "us", "usa": "us", "us": "us",
      "méxico": "mx", "mexico": "mx", "mx": "mx",
      "españa": "es", "espana": "es", "es": "es",
      "colombia": "co", "co": "co",
      "chile": "cl", "cl": "cl",
      "perú": "pe", "peru": "pe", "pe": "pe",
      "uruguay": "uy", "uy": "uy",
      "paraguay": "py", "py": "py",
      "brasil": "br", "brazil": "br", "br": "br"
    };
    return countryMap[v] || (v.length === 2 ? v : "");
  }
  if (type === "zp") {
    return String(v).replace(/\D/g, "").slice(0, 12);
  }
  return v;
}

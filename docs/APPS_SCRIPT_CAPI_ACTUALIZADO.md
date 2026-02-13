# Apps Script - Actualizaciones CAPI según buenas prácticas de Meta

Este documento detalla los cambios a aplicar en tu Apps Script para cumplir con las [Buenas Prácticas de Meta Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/best-practices).

---

## Checklist de buenas prácticas Meta CAPI

| Práctica | Estado | Nota |
|----------|--------|------|
| `action_source` en todos los eventos | ✅ | Ya usás `"website"` |
| `event_source_url` en eventos web | ✅ | Requerido, ya incluido |
| `client_user_agent` en eventos web | ✅ | Requerido, ya incluido |
| `client_ip_address` | ✅ | Mejora matching, ya incluido |
| `event_id` para deduplicación | ✅ | Recomendado, ya incluido |
| `external_id` en user_data | ✅ | Recomendado, ya incluido |
| Parámetro `zp` (no `zip`) para código postal | ⚠️ | **Corregir** |
| Normalización de ciudad (ct): sin espacios | ⚠️ | **Agregar** |
| País en formato ISO 2 letras | ⚠️ | **Agregar** |
| `em`, `ph`, `fn`, `ln` hasheados | ✅ | Ya implementado |
| `fbp`, `fbc` sin hashear | ✅ | Correcto |
| Evitar combinaciones inválidas de parámetros | ✅ | Tenés em, ph, fn, ln, fbp, fbc, etc. |

---

## 1. Nueva función de normalización (agregar al final de Helpers)

Agregá esta función **antes** de `hash()`:

```javascript
/**
 * Normalización para Meta CAPI (mejora Event Match Quality)
 * - Ciudad (ct): lowercase, sin espacios ni puntuación
 * - País: ISO 3166-1 alpha-2 (2 letras)
 */
function normForMeta(value, type) {
  if (!value || String(value).trim() === "") return "";
  const v = String(value).trim().toLowerCase();
  if (type === "ct") {
    return v.replace(/[\s\p{P}\p{S}]/gu, ""); // sin espacios, puntuación, símbolos
  }
  if (type === "zp") {
    return String(v).replace(/\D/g, "").slice(0, 12);
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
  return v;
}
```

---

## 2. Cambios en `enviarLeadParaFila`

### 2a. Reemplazar el bloque `userData` completo

**Buscar** (todo el bloque desde `const userData = {` hasta el cierre `};`):

```javascript
  const userData = {
    ...(v("email")      ? { em: hash(v("email")) } : {}),
    ...(v("phone")      ? { ph: hash(sanitizePhone(v("phone"))) } : {}),
    ...(v("fn")         ? { fn: hash(v("fn")) } : {}),
    ...(v("ln")         ? { ln: hash(v("ln")) } : {}),
    ...(v("ct")         ? { ct: hash(v("ct")) } : {}),
    ...(v("st")         ? { st: hash(v("st")) } : {}),
    ...(v("zip")        ? { zip: hash(v("zip")) } : {}),
    ...(v("country")    ? { country: hash(v("country")) } : {}),
```

**Reemplazar por**:

```javascript
  const userData = {
    ...(v("email")      ? { em: hash(String(v("email")).trim().toLowerCase()) } : {}),
    ...(v("phone")      ? { ph: hash(sanitizePhone(v("phone"))) } : {}),
    ...(v("fn")         ? { fn: hash(String(v("fn")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ln")         ? { ln: hash(String(v("ln")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ct")         ? { ct: hash(normForMeta(v("ct"), "ct")) } : {}),
    ...(v("st")         ? { st: hash(normForMeta(v("st"), "ct")) } : {}),
    ...(v("zip")        ? { zp: hash(normForMeta(v("zip"), "zp")) } : {}),
    ...(v("country")    ? { country: hash(normForMeta(v("country"), "country")) } : {}),
```

**Cambios clave:**
- `zip` → `zp` (nombre correcto según Meta)
- `ct` y `st` normalizados con `normForMeta`
- `country` normalizado a ISO 2 letras
- `zp`: solo dígitos, máximo 12 caracteres (UK format)

---

### 2b. Verificar que `client_user_agent` y `event_source_url` estén siempre presentes

Meta **requiere** `client_user_agent` para eventos web. Si `agentuser` está vacío, podés usar un fallback:

```javascript
...(v("agentuser") || "Unknown" ? { client_user_agent: v("agentuser") || "Unknown" } : {}),
```

(Y asegurate de que `event_source_url` nunca sea vacío: `srcUrl || CONFIG.EVENT_SOURCE_URL`)

---

## 3. Cambios en `enviarPurchaseParaFila`

Aplicar **exactamente los mismos cambios** que en `enviarLeadParaFila` para el bloque `userData`:

**Buscar** las mismas líneas (zip, ct, st, country, em, fn, ln) y **reemplazar** con la versión actualizada:

```javascript
    ...(v("email")      ? { em: hash(String(v("email")).trim().toLowerCase()) } : {}),
    ...(phone           ? { ph: hash(phone) } : {}),
    ...(v("fn")         ? { fn: hash(String(v("fn")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ln")         ? { ln: hash(String(v("ln")).trim().toLowerCase().replace(/\s+/g, " ")) } : {}),
    ...(v("ct")         ? { ct: hash(normForMeta(v("ct"), "ct")) } : {}),
    ...(v("st")         ? { st: hash(normForMeta(v("st"), "ct")) } : {}),
    ...(v("zip")        ? { zp: hash(normForMeta(v("zip"), "zp")) } : {}),
    ...(v("country")    ? { country: hash(normForMeta(v("country"), "country")) } : {}),
```

Nota: en Purchase usás `phone` (ya sanitizado) en lugar de `v("phone")`.

---

## 4. Parámetros opcionales recomendados por Meta

### 4a. `test_event_code` (para pruebas)

Si querés probar sin afectar datos reales, agregá en el payload (a nivel del array `data`, como parámetro del evento):

```javascript
const payload = {
  data: [{
    event_name: 'Lead',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'website',
    event_source_url: srcUrl,
    // test_event_code: 'TEST12345',  // ← Descomentar para pruebas
    user_data: userData
  }]
};
```

En Event Manager > Test Events podés ver los eventos con ese código.

### 4b. `partner_agent` (si sos agencia)

Si compartís eventos en nombre de advertisers:

```javascript
const payload = {
  data: [{ ... }],
  partner_agent: 'TU_NOMBRE_PLATAFORMA'  // ej: "Chiva77-Landing"
};
```

---

## 5. Action source para Lead/Purchase vía WhatsApp

Según el flujo:

- **Contact**: en la landing (website) → `action_source: "website"` ✅
- **Lead**: puede ser resultado de conversación WhatsApp → considerar `"chat"` o `"business_messaging"`
- **Purchase**: si la carga se hace por WhatsApp → `"chat"` o `"business_messaging"`

Meta define:
- `chat` = conversión vía messaging app, SMS o chat online
- `business_messaging` = desde ads que abren Messenger, Instagram o WhatsApp

Si Lead y Purchase se disparan cuando el usuario actúa **en WhatsApp** (no en la web), podés usar:

```javascript
action_source: 'business_messaging'  // en lugar de 'website'
```

Si considerás que todo el funnel arranca en la web, mantener `"website"` también es válido.

---

## 6. Resumen de cambios mínimos obligatorios

1. **zip → zp** en `enviarLeadParaFila` y `enviarPurchaseParaFila`
2. Agregar función `normForMeta` y usarla para `ct`, `st`, `country`
3. Asegurar que `client_user_agent` nunca sea vacío (fallback `"Unknown"` si falta)

Con eso tu integración queda alineada con las buenas prácticas de Meta.

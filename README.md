# Landing 1.5 — Chiva77

Landing page con redirección a WhatsApp usando **números dinámicos** obtenidos desde una fuente externa, almacenados en **Redis (Upstash)** y refrescados por **cron jobs**. Incluye envío a Google Sheets y Meta CAPI (Lead/Purchase) via Apps Script.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CRON (refresco de números)                    │
│                                                                      │
│  Vercel Cron (1x/día)  ─┐                                           │
│  cron-job.org (Nx/día)  ─┼──→ /api/phones-refresh                   │
│                           │      │                                   │
│                           │      ▼                                   │
│                           │   Fuente externa (ases/upstream)         │
│                           │      │                                   │
│                           │      ▼                                   │
│                           │   Upstash Redis (key: phones_pool)       │
│                           │      TTL: 20 min                         │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                        FLUJO DEL USUARIO                             │
│                                                                      │
│  1. Abre la landing                                                  │
│     → Pixel PageView (diferido)                                      │
│     → Botón en estado "Preparando..."                                │
│     → prewarmNumber() → fetch /api/phones-pool → obtiene números     │
│     → Botón cambia a "¡Contactar ya!"                                │
│                                                                      │
│  2. Click botón                                                      │
│     → Número ya en memoria (aleatorio)                               │
│     → Promo code generado                                            │
│     → Pixel Contact enriquecido (no bloquea)                         │
│     → (async) GEO + fetch /api/xz3v2q → Sheets (no bloquea)         │
│     → Redirect instantáneo a wa.me                                   │
│                                                                      │
│  3. Post-redirect (Apps Script)                                      │
│     → Sheet guarda fila "contact"                                    │
│     → LEAD/PURCHASE → Apps Script → Meta CAPI                        │
└──────────────────────────────────────────────────────────────────────┘
```

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `index.html` | HTML + CSS crítico inline + Meta Pixel diferido. JS mínimo. |
| `app.js` | JavaScript principal (cargado con `defer` + `preload`). Toda la lógica. |
| `styles.css` | Estilos completos + `.wa-btn-loading` (estado de carga del botón). |
| `vercel.json` | Cron job de Vercel. |
| `package.json` | Dependencia: `@upstash/redis`. |
| `imagenes/` | `fondo.avif`, `logo.png`, `whatsapp.png`, `favicon.png` |

### Backend (Vercel Serverless)

| Archivo | Ruta | Descripción |
|---------|------|-------------|
| `api/phones-pool.js` | `GET /api/phones-pool` | Lee números desde Redis. Fallback: consulta la fuente directamente. |
| `api/phones-refresh.js` | `GET /api/phones-refresh` | Cron endpoint: obtiene números de la fuente → guarda en Redis. |
| `api/_lib/phones-upstream.js` | (importado) | Función que consulta la fuente externa de números. |
| `api/xz3v2q.js` | `POST /api/xz3v2q` | Recibe datos del frontend → reenvía a Google Sheets (Apps Script). |
| `credenciales/google-sheets.js` | (importado) | URL del Apps Script. |

## Funcionalidades

### Todo lo de Landing 1.25

- Meta Pixel diferido (PageView + Contact enriquecido con advanced matching).
- Promo code único por click.
- Mensaje aleatorio.
- Anti doble-click.
- GEO detection (ipapi.co).
- Envío a Google Sheets (`/api/xz3v2q` + `keepalive`).
- fbp / fbc recolección.
- CAPI via Apps Script (Lead/Purchase).
- Critical CSS inline + CSS async.
- Accesibilidad y responsive.

### Números dinámicos (Redis + Cron)

A diferencia de 1.0 y 1.25 (números hardcodeados), la 1.5 obtiene números desde un pool dinámico:

#### `/api/phones-refresh.js` (Cron)

1. Valida autorización: `CRON_SECRET` via header `Authorization: Bearer` o query `?secret=`.
2. Conecta a Upstash Redis.
3. Llama a `fetchNumbersFromAses()` — consulta la fuente externa.
4. Guarda el resultado en Redis: `SET phones_pool <json> EX 1200` (TTL 20 min).
5. Retorna `{ ok: true, count, ts, stored_ttl }`.

#### `/api/phones-pool.js` (Frontend)

1. Intenta leer de Redis (key `phones_pool`).
2. Si tiene datos → responde con `{ numbers, count, ts, source: "redis" }`.
3. Si Redis vacío/falla → fallback a `fetchNumbersFromAses()` directo.
4. Headers de cache: `s-maxage=900, stale-while-revalidate=300` (CDN de Vercel cachea 15 min).

### Cron Job de Vercel

**Archivo**: `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/phones-refresh",
      "schedule": "0 6 * * *"
    }
  ]
}
```

- **Frecuencia**: 1 vez al día a las 06:00 UTC.
- **Limitación**: Plan Hobby de Vercel permite máximo 1 cron/día.

### Cron externo (cron-job.org)

Para refrescar con mayor frecuencia:

- **Servicio**: [cron-job.org](https://cron-job.org) (gratis).
- **URL**: `https://geraganamos.vercel.app/api/phones-refresh?secret={CRON_SECRET}`
- **Frecuencia**: Configurable (ej: cada 4 horas, cada 2 horas, etc.).
- **Autenticación**: El `CRON_SECRET` se pasa como query param `?secret=`.

### Prewarm del botón (app.js)

A diferencia de 1.0/1.25 (donde el número está listo al instante), la 1.5 necesita hacer un fetch al cargar:

1. **Al cargar**: botón muestra "Preparando..." con clase `wa-btn-loading` y `aria-disabled="true"`.
2. **`prewarmNumber()`**: hace `fetch("/api/phones-pool")` con timeout de 2 segundos.
3. **Cuando resuelve**: guarda resultado en `__pickedResult`, cambia botón a "¡Contactar ya!" y lo habilita.
4. **Si falla**: usa `EMERGENCY_FALLBACK_NUMBER` y habilita el botón igual.
5. **Al hacer click**: usa `__pickedResult` (ya en memoria). No espera nada. Redirect instantáneo.

### Selección aleatoria dinámica

El array de números viene de la API (no hardcodeado). Se elige uno al azar:

```javascript
function pickRandom(arr) {
  const n = arr.length;
  if (!n) return null;
  return arr[Math.floor(Math.random() * n)];
}
```

Cada usuario recibe un número aleatorio independiente, distribuyendo el tráfico de forma pareja entre todos los números disponibles en el pool.

### Fallback de emergencia

Si Redis está vacío Y la fuente externa falla, se usa:

```javascript
EMERGENCY_FALLBACK_NUMBER: "5491169789243",
EMERGENCY_FALLBACK_NAME: "Soporte"
```

El botón se habilita igual y redirige a ese número.

### JavaScript externalizado (`app.js`)

A diferencia de 1.0/1.25 (JS inline en `index.html`), la 1.5 tiene el JS en un archivo separado:

- **Carga**: `<script src="app.js" defer></script>` + `<link rel="preload" href="app.js" as="script">`.
- **Ventaja**: el navegador cachea `app.js` por separado del HTML.
- **Contenido**: `LANDING_CONFIG`, helpers, `getNumberFromApi`, `contactarWhatsApp`, `setButtonReady`, `DOMContentLoaded`.

### Google Apps Script

Idéntico al de Chiva77 1.25:

| Modo | Trigger | Qué hace |
|------|---------|----------|
| **A) Contact** | POST sin `action` | Guarda fila "contact" |
| **B1) Lead** | POST con `action: "LEAD"` | Busca por promo_code → Lead CAPI |
| **B2) Purchase** | POST con `action: "PURCHASE"` | Busca por promo_code → Purchase CAPI |
| **C) Simple Purchase** | POST con phone + amount | Crea fila → Purchase CAPI |

## Configuración

### `app.js`

```javascript
const LANDING_CONFIG = {
  BRAND_NAME: "",
  MODE: "ads",
  SERVICE_BASE: "/api/phones-pool",
  EMERGENCY_FALLBACK_NUMBER: "5491169789243",
  EMERGENCY_FALLBACK_NAME: "Soporte",
  PROMO: { ENABLED: true, LANDING_TAG: "CH1" },
  UI: { CLICK_GET_NUMBER_DEADLINE_MS: 2000 },
  GEO: { ENABLED: true, PROVIDER_URL: "https://ipapi.co/json/", TIMEOUT_MS: 900 }
};
```

### Pixel ID

En `index.html`, en el `<script>` del `<head>`:
- `fbq("init", "tu_pixel_id", {...})`
- `<noscript>` img con el mismo ID.

### `credenciales/google-sheets.js`

```javascript
export const CONFIG_SHEETS = {
  GOOGLE_SHEETS_URL: 'https://script.google.com/macros/s/.../exec'
};
```

### Apps Script

- `PIXEL_ID`, `ACCESS_TOKEN`, `API_VERSION` (actualmente `v24.0`).

## Variables de entorno (Vercel)

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `UPSTASH_REDIS_REST_URL` | URL de la instancia Upstash Redis | Si |
| `UPSTASH_REDIS_REST_TOKEN` | Token de autenticación de Upstash | Si |
| `CRON_SECRET` | Secret para proteger el endpoint `/api/phones-refresh` | Si |

### Cómo configurar Upstash Redis

1. Ir a [upstash.com](https://upstash.com) y crear cuenta.
2. Crear una nueva base de datos Redis (región: cualquiera, plan free).
3. Copiar `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` de la consola.
4. Ir a Vercel > Settings > Environment Variables y agregar ambas.

### Cómo configurar cron externo

1. Ir a [cron-job.org](https://cron-job.org) y crear cuenta.
2. Crear un nuevo cron job con:
   - **URL**: `https://{tu-dominio}.vercel.app/api/phones-refresh?secret={CRON_SECRET}`
   - **Método**: GET
   - **Frecuencia**: Elegir según necesidad (cada 2h, 4h, etc.).
3. Activar.

## Deploy

```bash
npm install        # Instala @upstash/redis
git add -A && git commit -m "cambios" && git push
```

El deploy se actualiza automáticamente en Vercel. Verificar que las variables de entorno estén configuradas.

### Verificar que funciona

1. Llamar a `https://{tu-dominio}.vercel.app/api/phones-refresh?secret={CRON_SECRET}` → debe devolver `{ ok: true, count: N }`.
2. Llamar a `https://{tu-dominio}.vercel.app/api/phones-pool` → debe devolver `{ numbers: [...], source: "redis" }`.
3. Abrir la landing → el botón debe pasar de "Preparando..." a "¡Contactar ya!".

## Dependencias

```json
{
  "@upstash/redis": "latest"
}
```

# Configuración: Cron + Redis (Opción 1)

Para que la landing obtenga los números lo más rápido posible, los números se pre-cargan en Redis cada 5 minutos. Cuando el usuario hace clic, `/api/phones-pool` lee desde Redis (muy rápido) en lugar de llamar a ases en ese momento.

---

## Pasos en Vercel

### 1. Upstash Redis

1. En el [Dashboard de Vercel](https://vercel.com/dashboard), abrí tu proyecto (Chiva77-Landing1.5).
2. **Storage** → **Create Database** → elegí **Upstash Redis** (o desde Marketplace → Upstash Redis).
3. Conectá la base al proyecto. Vercel agregará automáticamente:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. CRON_SECRET (recomendado)

Para que solo Vercel pueda llamar al endpoint de refresh:

1. **Settings** → **Environment Variables**
2. Agregá:
   - **Name:** `CRON_SECRET`
   - **Value:** una contraseña larga y aleatoria (ej. generada con `openssl rand -hex 24`)
   - **Environment:** Production (y Preview si querés)

Vercel enviará este valor en el header `Authorization: Bearer <CRON_SECRET>` cuando ejecute el cron. El endpoint `/api/phones-refresh` lo valida.

### 3. Redeploy

Después de agregar las variables, hacé un **Redeploy** del proyecto para que los cambios apliquen.

---

## Comportamiento

| Componente | Qué hace |
|------------|----------|
| **Cron** | Una vez por día (`0 6 * * *` = 6:00 UTC). En plan Hobby de Vercel los crons solo pueden ser diarios. |
| **phones-refresh** | Pide números a ases y los guarda en Redis (TTL 20 min). |
| **phones-pool** | Primero lee de Redis. Si hay datos, responde al instante. Si no, hace fallback a ases. |

La landing no cambia: sigue llamando a `/api/phones-pool`. La diferencia es que esa llamada suele ser una lectura en Redis en lugar de una llamada a ases.

---

## Refresco varias veces al día (plan Hobby)

En plan Hobby, Vercel solo ejecuta el cron **una vez por día**. Si los números disponibles cambian varias veces al día, podés usar un **cron externo gratuito** que llame a tu endpoint cada X minutos.

### Opción A: Con header (recomendado)

Servicios como [cron-job.org](https://cron-job.org) (gratis) permiten configurar un header. Creá un cron que cada 5–15 minutos haga:

- **URL:** `https://geraganamos.vercel.app/api/phones-refresh`
- **Método:** GET
- **Header:** `Authorization: Bearer TU_CRON_SECRET` (el mismo valor que en Vercel)

### Opción B: Con secret en la URL

Si el servicio solo permite configurar la URL, podés usar el parámetro `secret`:

- **URL:** `https://geraganamos.vercel.app/api/phones-refresh?secret=TU_CRON_SECRET`

**Importante:** No compartas esta URL; cualquiera que la tenga puede ejecutar el refresh. Si usás opción B, considerá un secret largo y aleatorio.

Así tenés: deploy estable en Hobby + pool actualizado tantas veces al día como configures el cron externo.

---

## Probar el refresh a mano

Con `CRON_SECRET` configurado:

```bash
# Con header
curl -H "Authorization: Bearer TU_CRON_SECRET" https://geraganamos.vercel.app/api/phones-refresh

# O con query (útil para crons externos que solo permiten URL)
curl "https://geraganamos.vercel.app/api/phones-refresh?secret=TU_CRON_SECRET"
```

Respuesta esperada: `{"ok":true,"count":N,"ts":"...","stored_ttl":1200}`

---

## Cómo verificar que funciona

### 1. ¿De dónde vienen los números?

Abrí en el navegador o con `curl`:

```
https://geraganamos.vercel.app/api/phones-pool
```

En la respuesta JSON buscá el campo **`source`**:

- **`"source": "redis"`** → Los números se sirven desde Redis (ruta rápida). El método nuevo está funcionando.
- **`"source": "upstream"`** → Redis estaba vacío o falló; se usó fallback a ases. Normal si acabas de deployar o si el cron aún no corrió; después del primer refresh debería pasar a `redis`.

### 2. Velocidad

- Con **redis**: la respuesta suele llegar en **pocas decenas de ms** (solo lee de Redis).
- Con **upstream**: puede tardar **más** (llamada a ases en vivo).

Podés comparar en DevTools (F12 → Network) el tiempo de la petición a `/api/phones-pool` cuando `source` es `redis` vs cuando es `upstream`.

### 3. Que el refresh llene Redis

- Ejecutá a mano el refresh (con tu `CRON_SECRET`) como en la sección anterior. Si ves `{"ok":true,"count":N,...}` → Redis se llenó.
- Después volvé a llamar a `/api/phones-pool`: debería devolver **`"source": "redis"`**.

### 4. Cron externo (cron-job.org)

En el panel del cron que creaste podés ver el **historial de ejecuciones** (si tenés “Save responses in job history” activado). Ahí ves si cada 10 min el refresh respondió 200 OK.

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

## Probar el refresh a mano

Con `CRON_SECRET` configurado:

```bash
curl -H "Authorization: Bearer TU_CRON_SECRET" https://geraganamos.vercel.app/api/phones-refresh
```

Respuesta esperada: `{"ok":true,"count":N,"ts":"...","stored_ttl":1200}`

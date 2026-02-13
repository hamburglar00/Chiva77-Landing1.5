# Flujo: prioridad redirección a WhatsApp

## Premisa

Lo primordial es **redirigir a WhatsApp**. El resto (Sheet, Pixel, geo, CAPI) no debe bloquear esa redirección.

---

## Cómo está planteado hoy (Landing 1.5)

En `contactarWhatsApp()` el orden es:

| Paso | Qué hace | ¿Bloquea el redirect? |
|------|----------|------------------------|
| 1 | Overlay "Abriendo WhatsApp..." | No |
| 2 | **Obtener número** (`await` prewarm o `getNumberFromApi`) | **Sí** – es el **único** paso que hace esperar |
| 3 | Validar teléfono | No (rápido) |
| 4 | Pixel `fbq("track","Contact", ...)` | No (envío en background) |
| 5 | **Sheet + CAPI** (`fetch("/api/xz3v2q", { keepalive: true })`) | **No** – se dispara en un IIFE async **sin await**; el redirect no espera |
| 6 | `window.location.assign(wa.me/...)` | – |

Conclusión: **Sheet, Pixel y geo no interfieren** con la redirección. Solo la **obtención del número** puede hacer esperar al usuario si hace clic antes de que termine el prewarm.

---

## Por qué la 1.0 parece “más instantánea”

- **Landing 1.0:** el número está fijo en el HTML (`numeros = ["5493516768842"]`). No hay llamada a API. Click → (opcional 150 ms para el pixel) → `window.open(wa.me)`.
- **Landing 1.5:** el número viene de `/api/phones-pool`. Si el usuario hace clic **antes** de que el prewarm termine, hay que **esperar** esa respuesta (con Redis suele ser ~50–200 ms).

---

## Cómo hacer el click tan instantáneo como la 1.0 (sin perder funcionalidad)

La idea: **no esperar el número en el momento del click**, sino **tenerlo ya listo** cuando el usuario puede hacer clic.

- **Prewarm:** ya se hace en `DOMContentLoaded` → se pide el número en cuanto carga la página.
- **Botón:** dejarlo deshabilitado (o mostrar “Preparando…”) hasta que el prewarm resuelva. Cuando el número está listo, se habilita el botón.
- **Click:** cuando el usuario hace clic, el número ya está en memoria → solo se arma el mensaje, se dispara Pixel/Sheet en background y se hace `window.location.assign(wa.me)` **sin ningún await**. El redirect es inmediato, como en la 1.0.

Así se mantienen Pixel, Sheet, geo, CAPI y pool de números, y la sensación de velocidad es la misma que en la 1.0.

Implementación sugerida: ver en `index.html` la lógica de “habilitar botón cuando `__pickedPromise` resuelve”.

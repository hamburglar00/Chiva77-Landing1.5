# Optimización de carga (first paint más rápido)

## ¿El Pixel diferido cumple con Meta?

**Sí.** Meta recomienda:
- Usar la implementación JavaScript (no IMG) y cargar `fbevents.js` de forma **asíncrona** — lo seguimos haciendo (inyectamos el script con `async`).
- Disparar PageView y pasar **Advanced Matching** (external_id, em, ph, fn, ln, country) en el **init** — lo seguimos haciendo en el mismo `setTimeout(0)`.
- No cargar el Pixel “demasiado tarde” (p. ej. tras varios segundos), para no perder atribución — con `setTimeout(..., 0)` el init y el PageView se ejecutan en el siguiente tick (milisegundos), no se retrasan.

La documentación de Meta incluye ejemplos con `setTimeout` para disparar eventos (p. ej. “Delayed Pixel Fires”). Aquí solo diferimos unos milisegundos para que el navegador pueda pintar antes; la cola `fbq` y los eventos (PageView, Contact) se comportan igual. Podés comprobarlo con la extensión [Meta Pixel Helper](https://developers.facebook.com/docs/meta-pixel/support/pixel-helper).

---

## Qué se hizo

1. **Pixel diferido**  
   En el `<head>` solo se define el stub de `fbq` (cola) y se programa el init/track en `setTimeout(..., 0)`. Así el primer pintado no espera a:
   - leer `localStorage` / `URLSearchParams`
   - inyectar `fbevents.js`
   - ejecutar `fbq("init")` y `fbq("track","PageView")`  
   El navegador pinta antes y el Pixel se inicializa justo después.

2. **App en archivo externo con `defer`**  
   Toda la lógica (config, prewarm, botón, redirect) está en `app.js` con `<script src="app.js" defer></script>`.  
   El HTML deja de estar bloqueado por ~300 líneas de JS inline; el parser termina antes y el primer pintado puede ocurrir en cuanto está el CSS y el body.  
   La config que editás sigue en **`app.js`** (LANDING_CONFIG, EMERGENCY_FALLBACK_NUMBER, etc.).

3. **Preload de recursos**  
   - `imagenes/fondo.avif` con `fetchpriority="high"`  
   - `app.js` con `<link rel="preload" href="app.js" as="script">` para que la descarga empiece pronto  

4. **Preconnect a Facebook**  
   `preconnect` + `dns-prefetch` a `connect.facebook.net` para reducir la latencia cuando se carga el Pixel.

## Qué ya estaba bien

- CSS único y liviano; tipografía con `system-ui` (sin fuentes externas).
- Imágenes con `decoding="async"`, `loading="lazy"` en el ícono de WhatsApp, `fetchpriority="high"` en logo y fondo.
- Prewarm del número al cargar para que el click sea instantáneo.

3. **Critical CSS inline**  
   En el `<head>` hay un bloque `<style>` con solo las reglas necesarias para el hero (reset, body, fondo, overlay, contenido, logo, título, botón, animaciones). Así el primer pintado no depende de descargar `styles.css`.  
   El archivo completo se carga con `media="print" onload="this.media='all'"`: el navegador lo pide sin bloquear y, al cargar, se aplica a la pantalla. Así se añaden responsive, `:focus`, `prefers-reduced-motion`, etc. sin retrasar el primer pintado.

4. **Preload de recursos**  
   (ya estaba) `fondo.avif` y `app.js` con `<link rel="preload">`.

## Posibles mejoras futuras (opcionales)

- **Cache de navegador**: cabeceras `Cache-Control` en Vercel para `styles.css` y `app.js` (por ejemplo `public, max-age=3600`) para que las visitas repetidas carguen más rápido.

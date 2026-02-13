// /api/phones-pool.js
// 1) Lee desde Redis (llenado por el cron phones-refresh) → respuesta rápida
// 2) Si Redis vacío o no configurado, fallback a ases (comportamiento anterior)

import { Redis } from "@upstash/redis";
import { fetchNumbersFromAses } from "./_lib/phones-upstream.js";

const REDIS_KEY = "phones_pool";

const CDN_CACHE = {
  S_MAXAGE: 900,
  SWR: 300,
};

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    `public, s-maxage=${CDN_CACHE.S_MAXAGE}, stale-while-revalidate=${CDN_CACHE.SWR}`
  );

  const redis = getRedis();

  if (redis) {
    try {
      const raw = await redis.get(REDIS_KEY);
      const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (payload && Array.isArray(payload.numbers) && payload.numbers.length > 0) {
        return res.status(200).json({
          numbers: payload.numbers,
          count: payload.count ?? payload.numbers.length,
          ts: payload.ts ?? new Date().toISOString(),
          agency_id: payload.agency_id ?? 17,
          source: "redis",
        });
      }
    } catch (_) {
      // Redis falló, continuar a fallback
    }
  }

  // Fallback: llamar a ases (mismo comportamiento que antes)
  try {
    const payload = await fetchNumbersFromAses();
    if (!payload.numbers?.length) {
      return res.status(503).json({
        error: "NO_ADS_NUMBERS",
        numbers: [],
      });
    }
    return res.status(200).json({
      numbers: payload.numbers,
      count: payload.count,
      ts: payload.ts,
      agency_id: payload.agency_id,
      source: "upstream",
    });
  } catch (e) {
    return res.status(503).json({
      error: "UPSTREAM_FAIL",
      message: String(e?.message || e),
      numbers: [],
    });
  }
}

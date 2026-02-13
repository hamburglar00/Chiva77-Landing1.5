/**
 * Endpoint para CRON: obtiene números de ases y los guarda en Redis.
 * Vercel Cron llama a esta URL cada X minutos (vercel.json).
 * Protegido por CRON_SECRET (solo requests con Authorization: Bearer <CRON_SECRET>).
 */

import { Redis } from "@upstash/redis";
import { fetchNumbersFromAses } from "./_lib/phones-upstream.js";

const REDIS_KEY = "phones_pool";
const TTL_SECONDS = 60 * 20; // 20 min (el cron refresca antes)

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export default async function handler(req, res) {
  // Solo permitir GET (Vercel Cron usa GET) o POST con secret
  const auth = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const redis = getRedis();
  if (!redis) {
    return res.status(503).json({
      error: "REDIS_NOT_CONFIGURED",
      message: "UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN deben estar definidos.",
    });
  }

  try {
    const payload = await fetchNumbersFromAses();
    if (!payload.numbers?.length) {
      return res.status(503).json({
        error: "NO_ADS_NUMBERS",
        message: "Upstream no devolvió números.",
      });
    }

    await redis.set(REDIS_KEY, JSON.stringify(payload), { ex: TTL_SECONDS });

    return res.status(200).json({
      ok: true,
      count: payload.count,
      ts: payload.ts,
      stored_ttl: TTL_SECONDS,
    });
  } catch (e) {
    console.error("phones-refresh error:", e);
    return res.status(503).json({
      error: "REFRESH_FAIL",
      message: String(e?.message || e),
    });
  }
}

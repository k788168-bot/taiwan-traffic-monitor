// src/app/api/incidents/route.ts

import { NextResponse } from "next/server";
import { fetchTrafficIncidents } from "@/lib/tdx";

// 快取 60 秒
let cache: { data: any; time: number } | null = null;
const CACHE_TTL = 60 * 1000;

export async function GET() {
  try {
    if (cache && Date.now() - cache.time < CACHE_TTL) {
      return NextResponse.json(cache.data);
    }

    const incidents = await fetchTrafficIncidents();

    cache = { data: incidents, time: Date.now() };

    return NextResponse.json(incidents, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch incidents" },
      { status: 500 }
    );
  }
}

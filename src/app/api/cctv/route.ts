// src/app/api/cctv/route.ts
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

// ===== TDX Token（獨立實作，避免模組問題）=====
let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }

  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("TDX_CLIENT_ID 或 TDX_CLIENT_SECRET 未設定");
  }

  const res = await fetch(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TDX Token 取得失敗 (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ===== 型別 =====
interface CCTVRaw {
  CCTVID?: string;
  CCTVName?: string;
  ImageURL?: string;
  VideoURL?: string;
  PositionLat?: number;
  PositionLon?: number;
  Latitude?: number;
  Longitude?: number;
  RoadName?: string;
  RouteName?: string;
  RoadID?: string;
}

interface CCTVItem {
  id: string;
  name: string;
  imageUrl: string;
  lat: number;
  lng: number;
  road: string;
}

// ===== 快取 =====
let cctvCache: { data: CCTVItem[]; time: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 分鐘

async function fetchAllCCTV(): Promise<CCTVItem[]> {
  if (cctvCache && Date.now() - cctvCache.time < CACHE_TTL) {
    return cctvCache.data;
  }

  const token = await getToken();
  const results: CCTVItem[] = [];

  const endpoints = [
    { url: "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?$top=1000&$format=JSON", label: "國道" },
    { url: "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Highway?$top=1000&$format=JSON", label: "省道" },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 0 },
      });

      if (!res.ok) {
        console.error(`CCTV ${ep.label} API 回應 ${res.status}`);
        continue;
      }

      const raw = await res.json();
      // TDX 回傳格式可能是陣列或包在 CCTVList 裡
      const list: CCTVRaw[] = Array.isArray(raw) ? raw : (raw.CCTVList || raw.CCTVs || []);

      for (const cam of list) {
        const imageUrl = cam.ImageURL || cam.VideoURL || "";
        if (!imageUrl) continue;

        const lat = cam.PositionLat || cam.Latitude || 0;
        const lng = cam.PositionLon || cam.Longitude || 0;
        if (lat === 0 || lng === 0) continue;

        results.push({
          id: cam.CCTVID || `${ep.label}-${results.length}`,
          name: cam.CCTVName || cam.RoadName || `${ep.label}攝影機`,
          imageUrl,
          lat,
          lng,
          road: cam.RoadName || cam.RouteName || cam.RoadID || ep.label,
        });
      }
      console.log(`CCTV ${ep.label}: 取得 ${list.length} 支，有效 ${results.length} 支`);
    } catch (e) {
      console.error(`CCTV ${ep.label} 錯誤:`, e);
    }
  }

  if (results.length > 0) {
    cctvCache = { data: results, time: Date.now() };
  }
  return results;
}

// ===== 距離計算 =====
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 城市中心座標
const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  "台北": { lat: 25.033, lng: 121.565 }, "新北": { lat: 25.012, lng: 121.465 },
  "桃園": { lat: 24.994, lng: 121.301 }, "台中": { lat: 24.148, lng: 120.674 },
  "台南": { lat: 22.999, lng: 120.227 }, "高雄": { lat: 22.627, lng: 120.301 },
  "基隆": { lat: 25.128, lng: 121.739 }, "新竹": { lat: 24.804, lng: 120.969 },
  "苗栗": { lat: 24.560, lng: 120.821 }, "彰化": { lat: 24.052, lng: 120.516 },
  "南投": { lat: 23.909, lng: 120.684 }, "雲林": { lat: 23.709, lng: 120.431 },
  "嘉義": { lat: 23.480, lng: 120.449 }, "屏東": { lat: 22.669, lng: 120.486 },
  "宜蘭": { lat: 24.757, lng: 121.753 }, "花蓮": { lat: 23.977, lng: 121.604 },
  "台東": { lat: 22.756, lng: 121.144 }, "台灣": { lat: 23.698, lng: 120.961 },
};

// ===== API Handler =====
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city") || "台灣";
    const count = parseInt(searchParams.get("count") || "4", 10);

    // 檢查環境變數
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      return NextResponse.json({
        cctvs: [],
        error: "TDX API 金鑰未設定，請在 Vercel 環境變數中設定 TDX_CLIENT_ID 和 TDX_CLIENT_SECRET",
        debug: { hasTdxId: !!process.env.TDX_CLIENT_ID, hasTdxSecret: !!process.env.TDX_CLIENT_SECRET }
      });
    }

    const allCCTV = await fetchAllCCTV();

    if (allCCTV.length === 0) {
      return NextResponse.json({
        cctvs: [],
        message: "無法取得 CCTV 資料，可能是 TDX API 金鑰無效或 API 暫時無回應",
        debug: { totalCCTV: 0 }
      });
    }

    const center = CITY_CENTERS[city] || CITY_CENTERS["台灣"];

    const sorted = allCCTV
      .map((c) => ({ ...c, dist: haversine(center.lat, center.lng, c.lat, c.lng) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, count);

    return NextResponse.json({
      cctvs: sorted,
      debug: { city, totalCCTV: allCCTV.length, nearestDist: sorted[0]?.dist?.toFixed(1) }
    });
  } catch (err: any) {
    console.error("CCTV API error:", err);
    return NextResponse.json({
      cctvs: [],
      error: `CCTV 取得失敗: ${err.message || "未知錯誤"}`,
    }, { status: 500 });
  }
}

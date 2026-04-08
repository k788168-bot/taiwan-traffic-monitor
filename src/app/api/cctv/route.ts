// src/app/api/cctv/route.ts
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

// ===== TDX Token =====
let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }

  const clientId = process.env.TDX_CLIENT_ID;
  const clientSecret = process.env.TDX_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("TDX API 金鑰未設定");

  const res = await fetch(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    }
  );
  if (!res.ok) throw new Error(`TDX Token 失敗 (${res.status})`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// ===== 型別 =====
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
const CACHE_TTL = 15 * 60 * 1000; // 15 分鐘（減少 API 呼叫避免限流）

async function fetchAllCCTV(): Promise<CCTVItem[]> {
  if (cctvCache && Date.now() - cctvCache.time < CACHE_TTL) {
    return cctvCache.data;
  }

  const token = await getToken();
  const results: CCTVItem[] = [];

  // 先只抓國道（省道容易被限流），一次抓多一點
  const endpoints = [
    "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?%24top=1000&%24format=JSON",
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (res.status === 429) {
        console.warn("TDX API 限流，使用快取資料");
        continue;
      }
      if (!res.ok) continue;

      const raw = await res.json();

      // TDX 回傳格式：{ CCTVs: [...] }
      let list: any[] = [];
      if (Array.isArray(raw)) {
        list = raw;
      } else if (raw.CCTVs) {
        list = raw.CCTVs;
      } else if (raw.CCTVList) {
        list = raw.CCTVList;
      } else {
        // 嘗試找第一個陣列
        for (const k of Object.keys(raw)) {
          if (Array.isArray(raw[k])) { list = raw[k]; break; }
        }
      }

      for (const cam of list) {
        // VideoStreamURL 是即時影像串流，ImageURL 是靜態截圖
        const imageUrl = cam.ImageURL || cam.VideoStreamURL || cam.VideoURL || "";
        if (!imageUrl) continue;

        const lat = cam.PositionLat || cam.Latitude || 0;
        const lng = cam.PositionLon || cam.Longitude || 0;
        if (lat === 0 || lng === 0) continue;

        const section = cam.RoadSection || "";
        const name = cam.CCTVName || (cam.RoadName ? `${cam.RoadName} ${section}`.trim() : "攝影機");

        results.push({
          id: cam.CCTVID || `cctv-${results.length}`,
          name,
          imageUrl,
          lat,
          lng,
          road: cam.RoadName || cam.RouteName || "",
        });
      }
    } catch (e) {
      console.error("CCTV fetch error:", e);
    }
  }

  // 如果國道成功，再嘗試省道（加 1 秒延遲避免限流）
  if (results.length > 0) {
    try {
      await new Promise((r) => setTimeout(r, 1000));
      const res2 = await fetch(
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Highway?%24top=1000&%24format=JSON",
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      if (res2.ok) {
        const raw2 = await res2.json();
        const list2: any[] = raw2.CCTVs || raw2.CCTVList || (Array.isArray(raw2) ? raw2 : []);
        for (const cam of list2) {
          const imageUrl = cam.ImageURL || cam.VideoStreamURL || cam.VideoURL || "";
          if (!imageUrl) continue;
          const lat = cam.PositionLat || cam.Latitude || 0;
          const lng = cam.PositionLon || cam.Longitude || 0;
          if (lat === 0 || lng === 0) continue;
          results.push({
            id: cam.CCTVID || `hw-${results.length}`,
            name: cam.CCTVName || cam.RoadName || "省道攝影機",
            imageUrl,
            lat,
            lng,
            road: cam.RoadName || cam.RouteName || "省道",
          });
        }
      }
    } catch {} // 省道失敗不影響
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

// ===== API =====
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city") || "台灣";
    const count = parseInt(searchParams.get("count") || "4", 10);

    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      return NextResponse.json({ cctvs: [], error: "TDX API 金鑰未設定" });
    }

    const allCCTV = await fetchAllCCTV();

    if (allCCTV.length === 0) {
      return NextResponse.json({ cctvs: [], message: "CCTV 資料暫時無法取得，請稍後再試" });
    }

    const center = CITY_CENTERS[city] || CITY_CENTERS["台灣"];
    const sorted = allCCTV
      .map((c) => ({ ...c, dist: haversine(center.lat, center.lng, c.lat, c.lng) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, count);

    return NextResponse.json({ cctvs: sorted, total: allCCTV.length });
  } catch (err: any) {
    console.error("CCTV API error:", err);
    return NextResponse.json({ cctvs: [], error: err.message || "CCTV 取得失敗" }, { status: 500 });
  }
}

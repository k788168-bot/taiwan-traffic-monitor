// src/app/api/cctv/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getTdxToken } from "@/lib/tdx";

export interface CCTVItem {
  id: string;
  name: string;
  imageUrl: string;
  lat: number;
  lng: number;
  road: string;
  city: string;
}

// 城市名稱對應
const CITY_MAP: Record<string, string> = {
  "台北": "Taipei", "新北": "NewTaipei", "桃園": "Taoyuan",
  "台中": "Taichung", "台南": "Tainan", "高雄": "Kaohsiung",
  "基隆": "Keelung", "新竹": "HssinchuCounty", "苗栗": "MiaoliCounty",
  "彰化": "ChanghuaCounty", "南投": "NantouCounty", "雲林": "YunlinCounty",
  "嘉義": "ChiayiCounty", "屏東": "PingtungCounty", "宜蘭": "YilanCounty",
  "花蓮": "HualienCounty", "台東": "TaitungCounty",
};

// 快取 CCTV 資料（5 分鐘）
let cctvCache: { data: CCTVItem[]; time: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function fetchAllCCTV(): Promise<CCTVItem[]> {
  if (cctvCache && Date.now() - cctvCache.time < CACHE_TTL) {
    return cctvCache.data;
  }

  const token = await getTdxToken();
  const results: CCTVItem[] = [];

  // 1. 國道 CCTV
  try {
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?$top=500&$format=JSON",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const list = data.CCTVList || data || [];
      for (const cam of list) {
        if (!cam.ImageURL && !cam.VideoURL) continue;
        results.push({
          id: cam.CCTVID || `freeway-${results.length}`,
          name: cam.CCTVName || cam.RoadName || "國道攝影機",
          imageUrl: cam.ImageURL || cam.VideoURL || "",
          lat: cam.Latitude || cam.PositionLat || 0,
          lng: cam.Longitude || cam.PositionLon || 0,
          road: cam.RoadName || cam.RouteName || "國道",
          city: cam.RoadName || "國道",
        });
      }
    }
  } catch (e) {
    console.error("Failed to fetch freeway CCTV:", e);
  }

  // 2. 省道 CCTV
  try {
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Highway?$top=500&$format=JSON",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      const list = data.CCTVList || data || [];
      for (const cam of list) {
        if (!cam.ImageURL && !cam.VideoURL) continue;
        results.push({
          id: cam.CCTVID || `highway-${results.length}`,
          name: cam.CCTVName || cam.RoadName || "省道攝影機",
          imageUrl: cam.ImageURL || cam.VideoURL || "",
          lat: cam.Latitude || cam.PositionLat || 0,
          lng: cam.Longitude || cam.PositionLon || 0,
          road: cam.RoadName || cam.RouteName || "省道",
          city: cam.RoadName || "省道",
        });
      }
    }
  } catch (e) {
    console.error("Failed to fetch highway CCTV:", e);
  }

  cctvCache = { data: results, time: Date.now() };
  return results;
}

// 計算兩點距離（公里）
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 城市中心座標（用於依城市名搜尋最近 CCTV）
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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const city = searchParams.get("city") || "台灣";
    const count = parseInt(searchParams.get("count") || "3", 10);

    const allCCTV = await fetchAllCCTV();

    if (allCCTV.length === 0) {
      return NextResponse.json({ cctvs: [], message: "無法取得 CCTV 資料" });
    }

    // 取得城市中心座標
    const center = CITY_CENTERS[city] || CITY_CENTERS["台灣"];

    // 依距離排序，取最近的幾支
    const sorted = allCCTV
      .filter((c) => c.lat !== 0 && c.lng !== 0)
      .map((c) => ({ ...c, dist: haversine(center.lat, center.lng, c.lat, c.lng) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, count);

    return NextResponse.json({ cctvs: sorted });
  } catch (err) {
    console.error("CCTV API error:", err);
    return NextResponse.json({ cctvs: [], error: "取得 CCTV 失敗" }, { status: 500 });
  }
}

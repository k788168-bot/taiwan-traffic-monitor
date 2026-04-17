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

// ===== 城市代碼映射（TDX City API 使用英文代碼） =====
const CITY_CODE: Record<string, string> = {
  "台北": "Taipei", "新北": "NewTaipei", "桃園": "Taoyuan",
  "台中": "Taichung", "台南": "Tainan", "高雄": "Kaohsiung",
  "基隆": "Keelung", "新竹": "Hsinchu", "苗栗": "MiaoliCounty",
  "彰化": "ChanghuaCounty", "南投": "NantouCounty", "雲林": "YunlinCounty",
  "嘉義": "Chiayi", "屏東": "PingtungCounty", "宜蘭": "YilanCounty",
  "花蓮": "HualienCounty", "台東": "TaitungCounty",
};

// ===== 快取 =====
// 全國性快取（國道+省道）
let nationalCache: { data: CCTVItem[]; time: number } | null = null;
// 城市快取（各城市市區道路）
const cityCache: Record<string, { data: CCTVItem[]; time: number }> = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 分鐘

function parseCCTVList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw.CCTVs) return raw.CCTVs;
  if (raw.CCTVList) return raw.CCTVList;
  for (const k of Object.keys(raw)) {
    if (Array.isArray(raw[k])) return raw[k];
  }
  return [];
}

function parseCam(cam: any, fallbackPrefix: string): CCTVItem | null {
  // 優先用靜態截圖 ImageURL，其次 VideoStreamURL（但排除 rtsp:// 串流）
  const candidates = [cam.ImageURL, cam.VideoStreamURL, cam.VideoURL].filter(Boolean);
  let imageUrl = candidates.find((u: string) => u.startsWith("http://") || u.startsWith("https://")) || "";
  if (!imageUrl) return null;
  // 強制升級為 HTTPS，避免混合內容被瀏覽器阻擋
  imageUrl = imageUrl.replace(/^http:\/\//, "https://");
  const lat = cam.PositionLat || cam.Latitude || 0;
  const lng = cam.PositionLon || cam.Longitude || 0;
  if (lat === 0 || lng === 0) return null;

  const section = typeof cam.RoadSection === "string"
    ? cam.RoadSection
    : (cam.RoadSection?.Start || cam.LocationMile || "");
  const direction = cam.RoadDirection === "N" ? "北向" : cam.RoadDirection === "S" ? "南向"
    : cam.RoadDirection === "E" ? "東向" : cam.RoadDirection === "W" ? "西向" : "";
  const name = cam.CCTVName || (cam.RoadName
    ? `${cam.RoadName} ${section} ${direction}`.trim()
    : `${fallbackPrefix}攝影機`);

  return {
    id: cam.CCTVID || `cctv-${Math.random().toString(36).slice(2, 8)}`,
    name,
    imageUrl,
    lat,
    lng,
    road: cam.RoadName || cam.RouteName || "",
  };
}

async function fetchNationalCCTV(): Promise<CCTVItem[]> {
  if (nationalCache && Date.now() - nationalCache.time < CACHE_TTL) {
    return nationalCache.data;
  }

  const token = await getToken();
  const results: CCTVItem[] = [];

  // 國道
  try {
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?%24top=1000&%24format=JSON",
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );
    if (res.ok) {
      const list = parseCCTVList(await res.json());
      for (const cam of list) {
        const item = parseCam(cam, "國道");
        if (item) results.push(item);
      }
    }
  } catch (e) { console.error("Freeway CCTV error:", e); }

  // 省道（延遲 1 秒避免限流）
  if (results.length > 0) {
    try {
      await new Promise((r) => setTimeout(r, 1000));
      const res = await fetch(
        "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Highway?%24top=1000&%24format=JSON",
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
      );
      if (res.ok) {
        const list = parseCCTVList(await res.json());
        for (const cam of list) {
          const item = parseCam(cam, "省道");
          if (item) results.push(item);
        }
      }
    } catch {} // 省道失敗不影響
  }

  if (results.length > 0) {
    nationalCache = { data: results, time: Date.now() };
  }
  return results;
}

// 抓取特定城市的市區道路 CCTV
async function fetchCityCCTV(cityName: string): Promise<CCTVItem[]> {
  const cityCode = CITY_CODE[cityName];
  if (!cityCode) return [];

  // 檢查快取
  if (cityCache[cityCode] && Date.now() - cityCache[cityCode].time < CACHE_TTL) {
    return cityCache[cityCode].data;
  }

  try {
    const token = await getToken();
    const url = `https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/City/${cityCode}?%24top=500&%24format=JSON`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (res.status === 429) {
      console.warn(`City CCTV 限流: ${cityCode}`);
      return cityCache[cityCode]?.data || [];
    }
    if (!res.ok) {
      console.warn(`City CCTV 失敗 (${res.status}): ${cityCode}`);
      return [];
    }

    const list = parseCCTVList(await res.json());
    const results: CCTVItem[] = [];
    for (const cam of list) {
      const item = parseCam(cam, cityName);
      if (item) results.push(item);
    }

    if (results.length > 0) {
      cityCache[cityCode] = { data: results, time: Date.now() };
    }
    return results;
  } catch (e) {
    console.error(`City CCTV error (${cityCode}):`, e);
    return [];
  }
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
    const latParam = searchParams.get("lat");
    const lngParam = searchParams.get("lng");
    const city = searchParams.get("city") || "台灣";
    const road = searchParams.get("road") || "";
    const count = parseInt(searchParams.get("count") || "4", 10);

    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      return NextResponse.json({ cctvs: [], error: "TDX API 金鑰未設定" });
    }

    // 同時抓全國 CCTV 和該城市的市區 CCTV
    const cityShort = city.replace(/[市縣]$/, "");
    const [nationalCCTV, cityCCTV] = await Promise.all([
      fetchNationalCCTV(),
      fetchCityCCTV(cityShort),
    ]);

    // 合併所有 CCTV（去重複）
    const idSet = new Set<string>();
    const allCCTV: CCTVItem[] = [];
    // 市區 CCTV 優先加入
    for (const c of cityCCTV) {
      if (!idSet.has(c.id)) { idSet.add(c.id); allCCTV.push(c); }
    }
    for (const c of nationalCCTV) {
      if (!idSet.has(c.id)) { idSet.add(c.id); allCCTV.push(c); }
    }

    if (allCCTV.length === 0) {
      return NextResponse.json({ cctvs: [], message: "CCTV 資料暫時無法取得，請稍後再試" });
    }

    // 使用精確座標（優先）或城市中心
    const centerLat = latParam ? parseFloat(latParam) : (CITY_CENTERS[cityShort]?.lat || CITY_CENTERS["台灣"].lat);
    const centerLng = lngParam ? parseFloat(lngParam) : (CITY_CENTERS[cityShort]?.lng || CITY_CENTERS["台灣"].lng);

    // 計算距離
    const withDist = allCCTV.map((c) => ({
      ...c,
      dist: haversine(centerLat, centerLng, c.lat, c.lng),
    }));

    // 策略：優先同路段市區 CCTV → 最近距離的市區 CCTV → 最近的國道/省道 CCTV
    let results: (CCTVItem & { dist: number })[] = [];

    if (road) {
      // 嘗試匹配路名關鍵字
      const roadKey = road.replace(/[號線路段東西南北一二三四五六七八九十]/g, "").slice(0, 2);
      const roadMatches = withDist
        .filter((c) => (c.road.includes(roadKey) || c.name.includes(roadKey)) && c.dist < 20)
        .sort((a, b) => a.dist - b.dist);
      results = roadMatches.slice(0, count);
    }

    // 補上距離最近的（優先市區 CCTV，5km 內）
    if (results.length < count) {
      const usedIds = new Set(results.map((r) => r.id));
      // 先找市區 CCTV（非國道、非省道）
      const cityNearby = withDist
        .filter((c) => !usedIds.has(c.id) && !c.road.startsWith("國道") && !c.road.match(/^台\d/) && c.dist < 10)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, count - results.length);
      results = [...results, ...cityNearby];
    }

    // 還不夠就用所有最近的
    if (results.length < count) {
      const usedIds = new Set(results.map((r) => r.id));
      const nearest = withDist
        .filter((c) => !usedIds.has(c.id))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, count - results.length);
      results = [...results, ...nearest];
    }

    return NextResponse.json({
      cctvs: results,
      total: allCCTV.length,
      cityCount: cityCCTV.length,
      nationalCount: nationalCCTV.length,
    });
  } catch (err: any) {
    console.error("CCTV API error:", err);
    return NextResponse.json({ cctvs: [], error: err.message || "CCTV 取得失敗" }, { status: 500 });
  }
}

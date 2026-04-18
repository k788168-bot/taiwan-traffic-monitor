// src/app/api/incidents/route.ts
// 從 TDX 取得即時交通事件（事故、施工、封路等）
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// ===== TDX Token（共用 CCTV 的金鑰）=====
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
interface TDXEvent {
  EventID?: string;
  EventType?: number; // 1=事故 2=施工 3=壅塞 4=其他
  Description?: string;
  RoadName?: string;
  RoadDirection?: string;
  SectionName?: string;
  PositionLat?: number;
  PositionLon?: number;
  StartTime?: string;
  EndTime?: string;
  EventStatus?: number; // 1=發生 2=已排除
  Severity?: string;
  Direction?: string;
  SubEvents?: any[];
  // City event format
  SourceDescription?: string;
  Latitude?: number;
  Longitude?: number;
}

interface Incident {
  id: string;
  city: string;
  road: string;
  type: string;
  sev: "critical" | "major" | "minor";
  description: string;
  lat: number;
  lng: number;
  time: string;
  status: string;
  source: string; // freeway / highway / city
}

// 事件類型對應
const EVENT_TYPE: Record<number, string> = {
  1: "交通事故", 2: "道路施工", 3: "壅塞", 4: "其他事件",
};

// 城市代碼
const CITY_CODES = [
  "Taipei", "NewTaipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung",
  "Keelung", "Hsinchu", "MiaoliCounty", "ChanghuaCounty",
  "NantouCounty", "YunlinCounty", "Chiayi", "PingtungCounty",
  "YilanCounty", "HualienCounty", "TaitungCounty",
];

const CITY_NAME: Record<string, string> = {
  Taipei: "台北市", NewTaipei: "新北市", Taoyuan: "桃園市", Taichung: "台中市",
  Tainan: "台南市", Kaohsiung: "高雄市", Keelung: "基隆市", Hsinchu: "新竹市",
  MiaoliCounty: "苗栗縣", ChanghuaCounty: "彰化縣", NantouCounty: "南投縣",
  YunlinCounty: "雲林縣", Chiayi: "嘉義市", PingtungCounty: "屏東縣",
  YilanCounty: "宜蘭縣", HualienCounty: "花蓮縣", TaitungCounty: "台東縣",
};

function parseSeverity(ev: TDXEvent): "critical" | "major" | "minor" {
  const desc = (ev.Description || ev.SourceDescription || "").toLowerCase();
  if (/死亡|罹難|身亡|不治|重大/.test(desc)) return "critical";
  if (/重傷|酒駕|翻覆|追撞|火燒/.test(desc)) return "major";
  return "minor";
}

function parseStatus(ev: TDXEvent): string {
  if (ev.EventStatus === 2 || ev.EndTime) return "已排除";
  return "處理中";
}

function guessCity(ev: TDXEvent, source: string): string {
  const desc = ev.Description || ev.SourceDescription || ev.RoadName || "";
  const cities = ["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化", "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東"];
  for (const c of cities) {
    if (desc.includes(c)) return c + (["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹"].includes(c) ? "市" : "縣");
  }
  return source === "freeway" ? "國道" : "台灣";
}

function parseEvent(ev: TDXEvent, source: string, cityCode?: string): Incident | null {
  const lat = ev.PositionLat || ev.Latitude || 0;
  const lng = ev.PositionLon || ev.Longitude || 0;
  const desc = ev.Description || ev.SourceDescription || "";
  if (!desc) return null;

  const road = ev.RoadName || ev.SectionName || "";
  const city = cityCode ? (CITY_NAME[cityCode] || guessCity(ev, source)) : guessCity(ev, source);
  const eventType = ev.EventType ? (EVENT_TYPE[ev.EventType] || "其他事件") : "交通事件";

  return {
    id: ev.EventID || `evt-${Math.random().toString(36).slice(2, 8)}`,
    city,
    road,
    type: eventType,
    sev: parseSeverity(ev),
    description: desc.slice(0, 100),
    lat,
    lng,
    time: ev.StartTime || new Date().toISOString(),
    status: parseStatus(ev),
    source,
  };
}

// ===== 快取 =====
let incidentCache: { data: Incident[]; time: number } | null = null;
const CACHE_TTL = 2 * 60 * 1000; // 2 分鐘

async function fetchAllEvents(): Promise<{ incidents: Incident[]; debug: any }> {
  if (incidentCache && Date.now() - incidentCache.time < CACHE_TTL) {
    return { incidents: incidentCache.data, debug: { cached: true } };
  }

  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const results: Incident[] = [];
  const debug: any = { freeway: null, highway: null, cities: {} };

  // 1. 國道即時事件
  try {
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/Event/Freeway?%24top=50&%24format=JSON",
      { headers }
    );
    if (res.ok) {
      const raw = await res.json();
      debug.freeway = { keys: Object.keys(raw), isArray: Array.isArray(raw), sample: JSON.stringify(raw).slice(0, 500) };
      const events: TDXEvent[] = raw.Events || raw.EventList || (Array.isArray(raw) ? raw : []);
      for (const ev of events) {
        const inc = parseEvent(ev, "freeway");
        if (inc) results.push(inc);
      }
    } else {
      debug.freeway = { status: res.status, statusText: res.statusText };
    }
  } catch (e: any) { debug.freeway = { error: e.message }; console.error("Freeway events error:", e); }

  // 2. 省道即時事件（延遲避免限流）
  try {
    await new Promise((r) => setTimeout(r, 800));
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/Event/Highway?%24top=50&%24format=JSON",
      { headers }
    );
    if (res.ok) {
      const raw = await res.json();
      debug.highway = { keys: Object.keys(raw), isArray: Array.isArray(raw), sample: JSON.stringify(raw).slice(0, 500) };
      const events: TDXEvent[] = raw.Events || raw.EventList || (Array.isArray(raw) ? raw : []);
      for (const ev of events) {
        const inc = parseEvent(ev, "highway");
        if (inc) results.push(inc);
      }
    } else {
      debug.highway = { status: res.status, statusText: res.statusText };
    }
  } catch (e: any) { debug.highway = { error: e.message }; console.error("Highway events error:", e); }

  // 3. 各縣市即時事件（挑主要城市，避免限流）
  const mainCities = ["Taipei", "NewTaipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung"];
  for (const cityCode of mainCities) {
    try {
      await new Promise((r) => setTimeout(r, 600));
      const res = await fetch(
        `https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/Event/City/${cityCode}?%24top=30&%24format=JSON`,
        { headers }
      );
      if (res.status === 429) {
        debug.cities[cityCode] = { rateLimited: true };
        break;
      }
      if (res.ok) {
        const raw = await res.json();
        debug.cities[cityCode] = { keys: Object.keys(raw), isArray: Array.isArray(raw), sample: JSON.stringify(raw).slice(0, 300) };
        const events: TDXEvent[] = raw.Events || raw.EventList || (Array.isArray(raw) ? raw : []);
        for (const ev of events) {
          const inc = parseEvent(ev, "city", cityCode);
          if (inc) results.push(inc);
        }
      } else {
        debug.cities[cityCode] = { status: res.status };
      }
    } catch (e: any) { debug.cities[cityCode] = { error: e.message }; }
  }

  // 去重複（同一 EventID）
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  // 按時間排序（最新在前）
  unique.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  if (unique.length > 0) {
    incidentCache = { data: unique, time: Date.now() };
  }

  return { incidents: unique, debug };
}

// ===== API =====
export async function GET() {
  try {
    if (!process.env.TDX_CLIENT_ID || !process.env.TDX_CLIENT_SECRET) {
      return NextResponse.json({ incidents: [], error: "TDX API 金鑰未設定" });
    }

    const { incidents, debug } = await fetchAllEvents();

    return NextResponse.json({
      incidents,
      total: incidents.length,
      updatedAt: new Date().toISOString(),
      debug,
    });
  } catch (err: any) {
    console.error("Incidents API error:", err);
    return NextResponse.json({ incidents: [], error: err.message || "事件取得失敗" }, { status: 500 });
  }
}

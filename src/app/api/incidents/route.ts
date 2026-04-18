// src/app/api/incidents/route.ts
// 從 TDX 取得即時路況消息（事故、施工、壅塞等）
// 正確端點：/v2/Road/Traffic/Live/News/{Freeway|Highway|City/{City}}
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

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

// ===== TDX News 型別 =====
interface TDXNews {
  NewsID: string;
  Title: string;
  NewsCategory: number; // 1=交管措施 2=事故 3=壅塞 4=施工 99=其他
  Description: string;
  Department?: string;
  StartTime?: string;
  EndTime?: string;
  PublishTime?: string;
  UpdateTime?: string;
  NewsURL?: string;
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
  source: string;
}

// 消息類別對應
const NEWS_CATEGORY: Record<number, string> = {
  1: "交管措施", 2: "交通事故", 3: "壅塞", 4: "道路施工", 99: "其他事件",
};

// 城市代碼
const CITY_NAME: Record<string, string> = {
  Taipei: "台北市", NewTaipei: "新北市", Taoyuan: "桃園市", Taichung: "台中市",
  Tainan: "台南市", Kaohsiung: "高雄市", Keelung: "基隆市", Hsinchu: "新竹市",
  MiaoliCounty: "苗栗縣", ChanghuaCounty: "彰化縣", NantouCounty: "南投縣",
  YunlinCounty: "雲林縣", Chiayi: "嘉義市", PingtungCounty: "屏東縣",
  YilanCounty: "宜蘭縣", HualienCounty: "花蓮縣", TaitungCounty: "台東縣",
};

// 城市中心座標（News API 沒有經緯度，用城市中心近似）
const CITY_CENTER: Record<string, { lat: number; lng: number }> = {
  "台北市": { lat: 25.033, lng: 121.565 }, "新北市": { lat: 25.012, lng: 121.465 },
  "桃園市": { lat: 24.994, lng: 121.301 }, "台中市": { lat: 24.148, lng: 120.674 },
  "台南市": { lat: 22.999, lng: 120.227 }, "高雄市": { lat: 22.627, lng: 120.301 },
  "基隆市": { lat: 25.128, lng: 121.739 }, "新竹市": { lat: 24.804, lng: 120.969 },
  "苗栗縣": { lat: 24.560, lng: 120.821 }, "彰化縣": { lat: 24.052, lng: 120.516 },
  "南投縣": { lat: 23.909, lng: 120.684 }, "雲林縣": { lat: 23.709, lng: 120.431 },
  "嘉義市": { lat: 23.480, lng: 120.449 }, "屏東縣": { lat: 22.669, lng: 120.486 },
  "宜蘭縣": { lat: 24.757, lng: 121.753 }, "花蓮縣": { lat: 23.977, lng: 121.604 },
  "台東縣": { lat: 22.756, lng: 121.144 }, "國道": { lat: 24.5, lng: 121.0 },
};

// 判斷是否為事故（NewsCategory=2 或描述中含事故關鍵字）
function isAccident(news: TDXNews): boolean {
  if (news.NewsCategory === 2) return true;
  const text = `${news.Title} ${news.Description}`;
  return /事故|車禍|撞|翻覆|自撞|追撞|碰撞|側撞|肇事|火燒車|死亡|傷亡/.test(text);
}

function parseSeverity(news: TDXNews): "critical" | "major" | "minor" {
  const text = `${news.Title} ${news.Description}`;
  if (/死亡|罹難|身亡|不治|重大事故/.test(text)) return "critical";
  if (/重傷|酒駕|翻覆|追撞|火燒|全線封閉/.test(text)) return "major";
  return "minor";
}

function parseStatus(news: TDXNews): string {
  const text = `${news.Title} ${news.Description}`;
  if (news.EndTime) return "已排除";
  if (/已排除|恢復通行|開放通行|解除/.test(text)) return "已排除";
  return "處理中";
}

function guessCity(text: string, source: string): string {
  const cities = ["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化", "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東"];
  for (const c of cities) {
    if (text.includes(c)) return c + (["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "嘉義"].includes(c) ? "市" : "縣");
  }
  return source === "freeway" ? "國道" : source === "highway" ? "省道" : "台灣";
}

function guessRoad(text: string): string {
  // 嘗試從描述中提取路名（優先匹配國道/台線，再匹配一般路名）
  const freewayMatch = text.match(/國道\d+號/);
  if (freewayMatch) return freewayMatch[0];
  const provinceMatch = text.match(/台\d+[甲乙丙]?線/);
  if (provinceMatch) return provinceMatch[0];
  // 一般路名：需要前面是中文字（避免抓到亂碼如「+000路」）
  const roadMatch = text.match(/([\u4e00-\u9fff]{2,6}(路|街|大道|橋|隧道|交流道)(\d*段)?)/);
  return roadMatch ? roadMatch[0] : "";
}

function parseNews(news: TDXNews, source: string, cityCode?: string): Incident {
  const text = `${news.Title} ${news.Description}`;
  const city = cityCode ? (CITY_NAME[cityCode] || guessCity(text, source)) : guessCity(text, source);
  const road = guessRoad(text);
  const center = CITY_CENTER[city] || CITY_CENTER["國道"];
  // 加一點隨機偏移，避免同城市的點完全重疊
  const hash = news.NewsID.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const offsetLat = ((hash % 100) - 50) * 0.001;
  const offsetLng = (((hash * 7) % 100) - 50) * 0.001;

  return {
    id: news.NewsID,
    city,
    road,
    type: NEWS_CATEGORY[news.NewsCategory] || "交通事件",
    sev: parseSeverity(news),
    description: (news.Title || news.Description || "").slice(0, 120),
    lat: center.lat + offsetLat,
    lng: center.lng + offsetLng,
    time: news.StartTime || news.PublishTime || new Date().toISOString(),
    status: parseStatus(news),
    source,
  };
}

// ===== 快取 =====
let incidentCache: { data: Incident[]; time: number } | null = null;
const CACHE_TTL = 2 * 60 * 1000; // 2 分鐘

async function fetchAllNews(): Promise<{ incidents: Incident[]; debug: any }> {
  if (incidentCache && Date.now() - incidentCache.time < CACHE_TTL) {
    return { incidents: incidentCache.data, debug: { cached: true } };
  }

  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const results: Incident[] = [];
  const debug: any = { freeway: null, highway: null, cities: {} };

  // 1. 高速公路局最新消息
  try {
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/News/Freeway?%24top=50&%24format=JSON",
      { headers }
    );
    if (res.ok) {
      const raw = await res.json();
      const newses: TDXNews[] = raw.Newses || (Array.isArray(raw) ? raw : []);
      // 只保留事故類別 (NewsCategory=2) 或描述中包含事故關鍵字的
      const accidents = newses.filter((n) => isAccident(n));
      debug.freeway = { status: 200, total: newses.length, accidents: accidents.length };
      for (const n of accidents) {
        results.push(parseNews(n, "freeway"));
      }
    } else {
      debug.freeway = { status: res.status, statusText: res.statusText };
    }
  } catch (e: any) { debug.freeway = { error: e.message }; }

  // 2. 公路局最新消息
  try {
    await new Promise((r) => setTimeout(r, 600));
    const res = await fetch(
      "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/News/Highway?%24top=50&%24format=JSON",
      { headers }
    );
    if (res.ok) {
      const raw = await res.json();
      const newses: TDXNews[] = raw.Newses || (Array.isArray(raw) ? raw : []);
      const accidents = newses.filter((n) => isAccident(n));
      debug.highway = { status: 200, total: newses.length, accidents: accidents.length };
      for (const n of accidents) {
        results.push(parseNews(n, "highway"));
      }
    } else {
      debug.highway = { status: res.status, statusText: res.statusText };
    }
  } catch (e: any) { debug.highway = { error: e.message }; }

  // 3. 各縣市最新消息（主要城市）
  const mainCities = ["Taipei", "NewTaipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung"];
  for (const cityCode of mainCities) {
    try {
      await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(
        `https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/News/City/${cityCode}?%24top=50&%24format=JSON`,
        { headers }
      );
      if (res.status === 429) {
        debug.cities[cityCode] = { rateLimited: true };
        break;
      }
      if (res.ok) {
        const raw = await res.json();
        const newses: TDXNews[] = raw.Newses || (Array.isArray(raw) ? raw : []);
        const accidents = newses.filter((n) => isAccident(n));
        debug.cities[cityCode] = { status: 200, total: newses.length, accidents: accidents.length };
        for (const n of accidents) {
          results.push(parseNews(n, "city", cityCode));
        }
      } else {
        debug.cities[cityCode] = { status: res.status };
      }
    } catch (e: any) { debug.cities[cityCode] = { error: e.message }; }
  }

  // 去重複（同一 NewsID）
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

    const { incidents, debug } = await fetchAllNews();

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

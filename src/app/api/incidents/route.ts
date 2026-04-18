// src/app/api/incidents/route.ts
// 主要資料源：警廣即時路況（PBS）— 有精確經緯度、即時更新
// 備用資料源：TDX 城市 News — 有較詳細的事故描述
export const dynamic = "force-dynamic";
export const maxDuration = 30;
// 嘗試用亞洲區域以便連通台灣國內限定的 PBS API
export const preferredRegion = ["hkg1", "hnd1", "sin1"];

import { NextResponse } from "next/server";

// ===== 共用型別 =====
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

// ===== 警廣即時路況（PBS）=====
// API: https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata
// 欄位: region, srcdetail, areaNm, UID, direction, y1(緯度), x1(經度),
//       happentime, roadtype, road, modDttm, comment, happendate

interface PBSItem {
  UID: string;
  region: string;      // A=全, N=北, M=中, S=南, E=東
  srcdetail: string;
  areaNm: string;       // 地區/路段名稱
  road: string;
  direction: string;
  roadtype: string;     // 事故, 道路施工, 交通障礙, 阻塞, 其他, 交通管制, 災變, 號誌故障
  comment: string;
  happendate: string;   // YYYY-MM-DD
  happentime: string;   // HH:mm:ss.0000000
  modDttm: string;      // YYYY-MM-DD HH:mm:ss.ff
  x1: string;           // 經度
  y1: string;           // 緯度
}

const REGION_NAME: Record<string, string> = {
  N: "北部", M: "中部", S: "南部", E: "東部", A: "全國",
};

function guessCityFromPBS(item: PBSItem): string {
  const text = `${item.areaNm} ${item.comment} ${item.road}`;
  const cities = [
    "台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市",
    "基隆市", "新竹市", "苗栗縣", "彰化縣", "南投縣", "雲林縣",
    "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣",
  ];
  for (const c of cities) {
    if (text.includes(c)) return c;
  }
  // 用短名匹配
  const shortCities = ["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化", "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東"];
  for (const c of shortCities) {
    if (text.includes(c)) return c + (["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "嘉義"].includes(c) ? "市" : "縣");
  }
  // areaNm 裡有 "XX區" 格式
  const distMatch = text.match(/([\u4e00-\u9fff]{2,3})[市縣][-‧·]?([\u4e00-\u9fff]{1,3}區)/);
  if (distMatch) return distMatch[1] + "市";
  // 用 region 推測大區域
  if (item.areaNm.includes("國道") || item.areaNm.includes("高速公路")) return "國道";
  if (item.areaNm.includes("台") && /\d/.test(item.areaNm)) return "省道";
  return REGION_NAME[item.region] || "台灣";
}

function guessRoadFromPBS(item: PBSItem): string {
  const text = `${item.areaNm} ${item.comment} ${item.road}`;
  // 國道
  const fwMatch = text.match(/國道[１２３３45６78910\d]+號?/);
  if (fwMatch) return fwMatch[0].replace(/[１２３４５６７８９０]/g, (c) => "１２３４５６７８９０".indexOf(c).toString());
  if (text.includes("國道３") || text.includes("國道3") || text.includes("福爾摩沙")) return "國道3號";
  if (text.includes("國道１") || text.includes("國道1") || text.includes("中山高")) return "國道1號";
  if (text.includes("國道５") || text.includes("國道5") || text.includes("蔣渭水")) return "國道5號";
  // 省道 / 快速道路
  const hwMatch = text.match(/台\d+[甲乙丙]?線/);
  if (hwMatch) return hwMatch[0];
  const expMatch = text.match(/台\d+線/);
  if (expMatch) return expMatch[0];
  // 一般道路
  const roadMatch = text.match(/([\u4e00-\u9fff]{2,6}(路|街|大道|橋|隧道|交流道)(\d*段)?)/);
  return roadMatch ? roadMatch[0] : item.road || "";
}

function parsePBSSeverity(item: PBSItem): "critical" | "major" | "minor" {
  const text = item.comment;
  if (/死亡|罹難|身亡|不治|重大事故/.test(text)) return "critical";
  if (/重傷|酒駕|翻覆|追撞|火燒|全線封閉|封閉/.test(text)) return "major";
  return "minor";
}

function parsePBSStatus(item: PBSItem): string {
  const text = item.comment;
  if (/排除|恢復|開放通行|解除|完成/.test(text)) return "已排除";
  return "處理中";
}

function parsePBSIncident(item: PBSItem): Incident | null {
  const lat = parseFloat(item.y1);
  const lng = parseFloat(item.x1);
  if (!lat || !lng || lat < 21 || lat > 27 || lng < 118 || lng > 123) return null;

  const time = `${item.happendate}T${item.happentime.split(".")[0]}+08:00`;

  return {
    id: `pbs-${item.UID}`,
    city: guessCityFromPBS(item),
    road: guessRoadFromPBS(item),
    type: "交通事故",
    sev: parsePBSSeverity(item),
    description: item.comment.slice(0, 120),
    lat,
    lng,
    time,
    status: parsePBSStatus(item),
    source: "pbs",
  };
}

// ===== PBS 快取 =====
let pbsCache: { data: Incident[]; time: number } | null = null;
const PBS_CACHE_TTL = 2 * 60 * 1000; // 2 分鐘

async function fetchPBSIncidents(): Promise<{ incidents: Incident[]; debug: any }> {
  if (pbsCache && Date.now() - pbsCache.time < PBS_CACHE_TTL) {
    return { incidents: pbsCache.data, debug: { pbs: { cached: true, count: pbsCache.data.length } } };
  }

  const debug: any = { pbs: {} };

  try {
    const res = await fetch(
      "https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata",
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) }
    );

    if (!res.ok) {
      debug.pbs = { status: res.status, error: "PBS API 回應錯誤" };
      return { incidents: [], debug };
    }

    const data = await res.json();
    const items: PBSItem[] = data.result || (Array.isArray(data) ? data : []);

    // 只取事故
    const accidents = items.filter((item) => item.roadtype === "事故");

    // 只保留今日事故（台灣時間）
    const now = new Date();
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayStr = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, "0")}-${String(twNow.getDate()).padStart(2, "0")}`;
    const todayAccidents = accidents.filter((item) => item.happendate === todayStr);

    // 轉換
    const incidents: Incident[] = [];
    for (const item of todayAccidents) {
      const inc = parsePBSIncident(item);
      if (inc) incidents.push(inc);
    }

    // 按時間排序（最新在前）
    incidents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    debug.pbs = {
      status: 200,
      totalItems: items.length,
      totalAccidents: accidents.length,
      todayAccidents: todayAccidents.length,
      parsed: incidents.length,
      todayStr,
    };

    if (incidents.length > 0) {
      pbsCache = { data: incidents, time: Date.now() };
    }

    return { incidents, debug };
  } catch (err: any) {
    debug.pbs = { error: err.message || "PBS 連線失敗" };
    return { incidents: pbsCache?.data || [], debug };
  }
}

// ===== TDX（備用）=====
let cachedToken: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.token;
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

interface TDXNews {
  NewsID: string; Title: string; NewsCategory: number;
  Description: string; StartTime?: string; EndTime?: string;
  PublishTime?: string; Department?: string;
}

const CITY_NAME: Record<string, string> = {
  Taipei: "台北市", NewTaipei: "新北市", Taoyuan: "桃園市", Taichung: "台中市",
  Tainan: "台南市", Kaohsiung: "高雄市", Keelung: "基隆市", Hsinchu: "新竹市",
  ChanghuaCounty: "彰化縣", PingtungCounty: "屏東縣", YilanCounty: "宜蘭縣", HualienCounty: "花蓮縣",
};

const CITY_CENTER: Record<string, { lat: number; lng: number }> = {
  "台北市": { lat: 25.033, lng: 121.565 }, "新北市": { lat: 25.012, lng: 121.465 },
  "桃園市": { lat: 24.994, lng: 121.301 }, "台中市": { lat: 24.148, lng: 120.674 },
  "台南市": { lat: 22.999, lng: 120.227 }, "高雄市": { lat: 22.627, lng: 120.301 },
  "基隆市": { lat: 25.128, lng: 121.739 }, "新竹市": { lat: 24.804, lng: 120.969 },
  "彰化縣": { lat: 24.052, lng: 120.516 }, "屏東縣": { lat: 22.669, lng: 120.486 },
  "宜蘭縣": { lat: 24.757, lng: 121.753 }, "花蓮縣": { lat: 23.977, lng: 121.604 },
  "國道": { lat: 24.5, lng: 121.0 },
};

function isAccident(n: TDXNews): boolean {
  if (n.NewsCategory === 2) return true;
  return /事故|車禍|撞|翻覆|自撞|追撞|碰撞|側撞|肇事|火燒車|死亡|傷亡/.test(`${n.Title} ${n.Description}`);
}

let tdxCache: { data: Incident[]; time: number } | null = null;

async function fetchTDXIncidents(): Promise<{ incidents: Incident[]; debug: any }> {
  if (tdxCache && Date.now() - tdxCache.time < PBS_CACHE_TTL) {
    return { incidents: tdxCache.data, debug: { tdx: { cached: true, count: tdxCache.data.length } } };
  }

  const debug: any = { tdx: {} };
  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const results: Incident[] = [];

    const cities = ["Taipei", "NewTaipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung", "Keelung", "Hsinchu", "ChanghuaCounty", "PingtungCounty", "YilanCounty", "HualienCounty"];
    let cityResults: Record<string, number> = {};

    for (const cityCode of cities) {
      try {
        await new Promise((r) => setTimeout(r, 300));
        const res = await fetch(
          `https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/News/City/${cityCode}?%24top=50&%24format=JSON`,
          { headers, signal: AbortSignal.timeout(10000) }
        );
        if (res.status === 429) break;
        if (res.ok) {
          const raw = await res.json();
          const newses: TDXNews[] = raw.Newses || (Array.isArray(raw) ? raw : []);
          const accidents = newses.filter(isAccident);
          cityResults[cityCode] = accidents.length;
          for (const n of accidents) {
            const text = `${n.Title} ${n.Description}`;
            const city = CITY_NAME[cityCode] || "台灣";
            const center = CITY_CENTER[city] || CITY_CENTER["國道"];
            const hash = n.NewsID.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
            results.push({
              id: `tdx-${n.NewsID}`,
              city,
              road: guessRoadTDX(text),
              type: "交通事故",
              sev: /死亡|罹難/.test(text) ? "critical" : /重傷|翻覆|追撞|火燒/.test(text) ? "major" : "minor",
              description: (n.Title || n.Description || "").slice(0, 120),
              lat: center.lat + ((hash % 100) - 50) * 0.001,
              lng: center.lng + (((hash * 7) % 100) - 50) * 0.001,
              time: n.StartTime || n.PublishTime || new Date().toISOString(),
              status: n.EndTime || /已排除|恢復通行/.test(text) ? "已排除" : "處理中",
              source: "tdx",
            });
          }
        }
      } catch {}
    }

    // 今日篩選
    const now = new Date();
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayMidnightTW = new Date(twNow.getFullYear(), twNow.getMonth(), twNow.getDate()).getTime() - 8 * 60 * 60 * 1000;
    const today = results.filter((r) => new Date(r.time).getTime() >= todayMidnightTW);

    debug.tdx = { totalAccidents: results.length, todayAccidents: today.length, cities: cityResults };
    if (today.length > 0) tdxCache = { data: today, time: Date.now() };
    return { incidents: today, debug };
  } catch (err: any) {
    debug.tdx = { error: err.message };
    return { incidents: tdxCache?.data || [], debug };
  }
}

function guessRoadTDX(text: string): string {
  const fw = text.match(/國道\d+號/); if (fw) return fw[0];
  const hw = text.match(/台\d+[甲乙丙]?線/); if (hw) return hw[0];
  const rd = text.match(/([\u4e00-\u9fff]{2,6}(路|街|大道|橋|隧道|交流道)(\d*段)?)/);
  return rd ? rd[0] : "";
}

// ===== 合併 API =====
export async function GET() {
  try {
    // 同時抓兩個資料源
    const [pbsResult, tdxResult] = await Promise.all([
      fetchPBSIncidents(),
      process.env.TDX_CLIENT_ID ? fetchTDXIncidents() : Promise.resolve({ incidents: [], debug: { tdx: { skipped: true } } }),
    ]);

    // 合併（PBS 優先，TDX 補充不重複的）
    const allIncidents = [...pbsResult.incidents];
    const pbsIds = new Set(allIncidents.map((i) => i.id));

    // TDX 的事故如果和 PBS 不重複就加入
    for (const tdxInc of tdxResult.incidents) {
      // 檢查是否有描述相似的（避免同一事故重複）
      const isDuplicate = allIncidents.some((p) => {
        if (p.city === tdxInc.city && p.road === tdxInc.road) return true;
        // 距離 < 1km 且時間差 < 2 小時視為重複
        const dist = Math.sqrt((p.lat - tdxInc.lat) ** 2 + (p.lng - tdxInc.lng) ** 2);
        const timeDiff = Math.abs(new Date(p.time).getTime() - new Date(tdxInc.time).getTime());
        return dist < 0.01 && timeDiff < 2 * 60 * 60 * 1000;
      });
      if (!isDuplicate) allIncidents.push(tdxInc);
    }

    // 按時間排序
    allIncidents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return NextResponse.json({
      incidents: allIncidents,
      total: allIncidents.length,
      updatedAt: new Date().toISOString(),
      sources: {
        pbs: pbsResult.incidents.length,
        tdx: tdxResult.incidents.length,
      },
      debug: { ...pbsResult.debug, ...tdxResult.debug },
    });
  } catch (err: any) {
    console.error("Incidents API error:", err);
    return NextResponse.json({ incidents: [], error: err.message || "事件取得失敗" }, { status: 500 });
  }
}

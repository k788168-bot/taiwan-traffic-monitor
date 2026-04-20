// src/app/api/incidents/route.ts
// 主要資料源：TDX 道路事件 v1 API（RoadEvent LiveEvent）— 高速公路 + 縣市即時事件
// 備用資料源：警廣即時路況（PBS）— 台灣國內 IP 限定
export const dynamic = "force-dynamic";
export const maxDuration = 30;
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

// ===== TDX 認證 =====
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
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    }
  );
  if (!res.ok) throw new Error(`TDX Token 失敗 (${res.status})`);
  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ===== TDX RoadEvent LiveEvent API =====
// 高速公路: /v1/Traffic/RoadEvent/LiveEvent/Freeway
// 縣市:     /v1/Traffic/RoadEvent/LiveEvent/City/{City}

const ROADEVENT_CITIES = [
  "Taipei", "NewTaipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung",
  "Keelung", "Hsinchu", "HsinchuCounty", "MiaoliCounty", "ChanghuaCounty",
  "NantouCounty", "YunlinCounty", "ChiayiCounty", "Chiayi",
  "PingtungCounty", "YilanCounty", "HualienCounty", "TaitungCounty",
];

const CITY_NAME: Record<string, string> = {
  Taipei: "台北市", NewTaipei: "新北市", Taoyuan: "桃園市", Taichung: "台中市",
  Tainan: "台南市", Kaohsiung: "高雄市", Keelung: "基隆市", Hsinchu: "新竹市",
  HsinchuCounty: "新竹縣", MiaoliCounty: "苗栗縣", ChanghuaCounty: "彰化縣",
  NantouCounty: "南投縣", YunlinCounty: "雲林縣", ChiayiCounty: "嘉義縣",
  Chiayi: "嘉義市", PingtungCounty: "屏東縣", YilanCounty: "宜蘭縣",
  HualienCounty: "花蓮縣", TaitungCounty: "台東縣",
};

const CITY_CENTER: Record<string, { lat: number; lng: number }> = {
  "台北市": { lat: 25.033, lng: 121.565 }, "新北市": { lat: 25.012, lng: 121.465 },
  "桃園市": { lat: 24.994, lng: 121.301 }, "台中市": { lat: 24.148, lng: 120.674 },
  "台南市": { lat: 22.999, lng: 120.227 }, "高雄市": { lat: 22.627, lng: 120.301 },
  "基隆市": { lat: 25.128, lng: 121.739 }, "新竹市": { lat: 24.804, lng: 120.969 },
  "新竹縣": { lat: 24.839, lng: 121.004 }, "苗栗縣": { lat: 24.560, lng: 120.821 },
  "彰化縣": { lat: 24.052, lng: 120.516 }, "南投縣": { lat: 23.961, lng: 120.972 },
  "雲林縣": { lat: 23.709, lng: 120.431 }, "嘉義縣": { lat: 23.452, lng: 120.255 },
  "嘉義市": { lat: 23.480, lng: 120.449 }, "屏東縣": { lat: 22.669, lng: 120.486 },
  "宜蘭縣": { lat: 24.757, lng: 121.753 }, "花蓮縣": { lat: 23.977, lng: 121.604 },
  "台東縣": { lat: 22.756, lng: 121.145 }, "國道": { lat: 24.5, lng: 121.0 },
};

// 從 RoadEvent 提取座標
// 實際欄位: Positions = "POINT(121.199186 24.836942)" (WKT 格式)
function extractCoords(item: any): { lat: number; lng: number } | null {
  // Positions 欄位 (WKT POINT 格式) — TDX RoadEvent 實際使用的欄位
  const posStr = item.Positions || item.Geometry || "";
  if (typeof posStr === "string" && posStr.length > 0) {
    const pointMatch = posStr.match(/POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/i);
    if (pointMatch) {
      return { lng: parseFloat(pointMatch[1]), lat: parseFloat(pointMatch[2]) };
    }
  }

  // GeoJSON object 格式 (備用)
  if (typeof item.Geometry === "object" && item.Geometry?.coordinates) {
    return { lng: item.Geometry.coordinates[0], lat: item.Geometry.coordinates[1] };
  }

  return null;
}

// 判斷是否為事故類型
// TDX RoadEvent EventType: 1=事故, 2=施工, 3=災害, 4=管制, ...
function isAccidentEvent(item: any): boolean {
  const eventType = item.EventType;

  // EventType === 1 明確是事故
  if (eventType === 1 || eventType === "1") return true;

  // EventType === 3 災害也可能包含交通相關事件
  // if (eventType === 3 || eventType === "3") return true;

  // 用 EventTitle + Description 關鍵字補充判斷
  const title = item.EventTitle || "";
  const desc = item.Description || "";
  const text = `${title} ${desc}`;

  // 排除明顯的非事故（施工、維護、查修等）— 在 EventType 非 1 時排除
  if (eventType !== 1 && eventType !== "1") {
    if (/施工|維護|查修|養護|修繕|鋪設|挖掘|電纜|管線|水管|號誌|路燈|標誌|封閉施工/.test(text)) return false;
  }

  // 強事故關鍵字
  if (/車禍|撞車|追撞|自撞|側撞|碰撞|翻覆|肇事|火燒車|死亡|傷亡|酒駕|交通事故/.test(text)) return true;

  // 緊急救護（常見於台南119派遣系統，含車禍）
  if (/緊急救護/.test(title) && eventType === 1) return true;

  return false;
}

// 從事件資料提取道路名稱
// Location 欄位是 JSON 字串，如:
// {"FreeExpressHighway":{"Road":"國道三號","Direction":"北向","StartKM":"72K+300",...}}
// {"Other":"北投區往台北方向台2乙10K+888..."}
function extractRoad(item: any): string {
  // 先嘗試解析 Location JSON
  if (item.Location && typeof item.Location === "string") {
    try {
      const loc = JSON.parse(item.Location);
      if (loc.FreeExpressHighway?.Road) return loc.FreeExpressHighway.Road;
      if (loc.Road) return loc.Road;
      // Other 欄位也可能有路名
      if (loc.Other && typeof loc.Other === "string") {
        const rdMatch = loc.Other.match(/(台\d+[甲乙丙]?線?|國道[\d]+號?|[\u4e00-\u9fff]{2,6}(路|街|大道)(\d*段)?)/);
        if (rdMatch) return rdMatch[0];
      }
    } catch {}
  }

  if (item.RoadName) return item.RoadName;
  if (item.Road) return item.Road;

  const desc = item.Description || item.EventTitle || "";

  // 國道
  const fwMatch = desc.match(/國道\d+號?/);
  if (fwMatch) return fwMatch[0];
  if (desc.includes("福爾摩沙") || desc.includes("國道3") || desc.includes("國道３")) return "國道3號";
  if (desc.includes("中山高") || desc.includes("國道1") || desc.includes("國道１")) return "國道1號";

  // 省道
  const hwMatch = desc.match(/台\d+[甲乙丙]?線/);
  if (hwMatch) return hwMatch[0];

  // 一般道路
  const rdMatch = desc.match(/([\u4e00-\u9fff]{2,6}(路|街|大道|橋|隧道|交流道)(\d*段)?)/);
  if (rdMatch) return rdMatch[0];

  return item.RoadSection || "";
}

// 推斷嚴重度
// Impact 欄位是 JSON 字串: {"Description":"部分阻斷交通","Severity":1,"Regulations":[2],"BlockWay":1,"BlockedLanes":"3"}
// Severity: 1=輕微?, 2=中等?, 3=嚴重?
function guessSeverity(item: any): "critical" | "major" | "minor" {
  const desc = item.Description || item.EventTitle || "";

  // 先用關鍵字判斷
  if (/死亡|罹難|身亡|不治|重大事故/.test(desc)) return "critical";
  if (/重傷|酒駕|翻覆|追撞|火燒|全線封閉|封閉/.test(desc)) return "major";

  // 嘗試解析 Impact
  if (item.Impact && typeof item.Impact === "string") {
    try {
      const impact = JSON.parse(item.Impact);
      if (impact.Severity >= 3 || /全線|嚴重/.test(impact.Description || "")) return "critical";
      if (impact.Severity >= 2 || /部分阻斷/.test(impact.Description || "")) return "major";
    } catch {}
  }

  return "minor";
}

// 推斷處理狀態
// EventStep: 1=新事件, 2=更新中, 3=已結案?
function guessStatus(item: any): string {
  if (item.EventStep === 3 || item.EventStep === "3") return "已排除";
  const desc = item.Description || item.EventTitle || "";
  if (/排除|恢復|開放通行|解除|完成/.test(desc)) return "已排除";
  return "處理中";
}

// 提取事件時間（實際欄位: EffectiveTime, PublishTime, LastUpdateTime）
function extractTime(item: any): string {
  return (
    item.EffectiveTime ||
    item.PublishTime ||
    item.LastUpdateTime ||
    item.StartTime ||
    new Date().toISOString()
  );
}

// 提取事件 ID（實際欄位: EventID）
function extractId(item: any): string {
  return (
    item.EventID ||
    item.RoadEventID ||
    item.ID ||
    `re-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

// ===== RoadEvent 快取 =====
let roadEventCache: { data: Incident[]; time: number; rawSample: any } | null = null;
const CACHE_TTL = 2 * 60 * 1000; // 2 分鐘

async function fetchRoadEventIncidents(): Promise<{
  incidents: Incident[];
  debug: any;
}> {
  if (roadEventCache && Date.now() - roadEventCache.time < CACHE_TTL) {
    return {
      incidents: roadEventCache.data,
      debug: {
        roadEvent: { cached: true, count: roadEventCache.data.length },
      },
    };
  }

  const debug: any = { roadEvent: {} };
  const allIncidents: Incident[] = [];

  try {
    const token = await getToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };

    // 1. 高速公路即時事件（一次取全部）
    let freewayRaw: any = null;
    try {
      const res = await fetch(
        `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/LiveEvent/Freeway?$format=JSON`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        freewayRaw = await res.json();
        debug.roadEvent.freewayStatus = 200;
      } else {
        debug.roadEvent.freewayStatus = res.status;
        debug.roadEvent.freewayError = await res.text().catch(() => "");
      }
    } catch (err: any) {
      debug.roadEvent.freewayError = err.message;
    }

    // EventType 名稱對照
    const EVENT_TYPE_NAME: Record<number, string> = {
      1: "事故", 2: "施工", 3: "災害", 4: "管制", 5: "壅塞", 6: "其他",
    };

    // 處理高速公路事件
    if (freewayRaw) {
      const items = extractItems(freewayRaw);
      debug.roadEvent.freewayTotal = items.length;
      // 統計各類型數量
      const typeCounts: Record<string, number> = {};
      for (const item of items) {
        const typeName = EVENT_TYPE_NAME[item.EventType] || `未知(${item.EventType})`;
        typeCounts[typeName] = (typeCounts[typeName] || 0) + 1;
      }
      debug.roadEvent.freewayByType = typeCounts;
      // 保存第一筆原始資料作為 debug
      if (items.length > 0) {
        debug.roadEvent.freewayRawSample = sanitizeForDebug(items[0]);
        debug.roadEvent.freewayRawKeys = Object.keys(items[0]);
      }

      // 保存事故類型的原始範例
      const fwAccidentSample = items.find((i: any) => i.EventType === 1);
      if (fwAccidentSample) {
        debug.roadEvent.freewayAccidentSample = sanitizeForDebug(fwAccidentSample);
      }

      for (const item of items) {
        const inc = parseRoadEventItem(item, "國道", "freeway");
        if (inc) allIncidents.push(inc);
      }
      debug.roadEvent.freewayAccidents = allIncidents.length;
    }

    // 2. 縣市即時事件（批次）
    let cityTotal = 0;
    let cityAccidents = 0;
    const cityErrors: Record<string, string> = {};
    const cityTypeCounts: Record<string, number> = {};
    let citySampleSaved = false;

    // 批次處理，每 2 個城市一組，間隔 500ms 避免 rate limit
    for (let i = 0; i < ROADEVENT_CITIES.length; i += 2) {
      const batch = ROADEVENT_CITIES.slice(i, i + 2);
      if (i > 0) await new Promise((r) => setTimeout(r, 500));

      const batchResults = await Promise.allSettled(
        batch.map(async (cityCode) => {
          const res = await fetch(
            `https://tdx.transportdata.tw/api/basic/v1/Traffic/RoadEvent/LiveEvent/City/${cityCode}?$format=JSON`,
            { headers, signal: AbortSignal.timeout(8000) }
          );
          if (res.status === 429) throw new Error("rate-limited");
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return { cityCode, data: await res.json() };
        })
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          const { cityCode, data } = result.value;
          const items = extractItems(data);
          cityTotal += items.length;

          // 統計事件類型
          for (const item of items) {
            const typeName = EVENT_TYPE_NAME[item.EventType] || `未知(${item.EventType})`;
            cityTypeCounts[typeName] = (cityTypeCounts[typeName] || 0) + 1;
          }

          if (!citySampleSaved && items.length > 0) {
            debug.roadEvent.cityRawSample = sanitizeForDebug(items[0]);
            debug.roadEvent.cityRawKeys = Object.keys(items[0]);
            // 找一個事故類型的範例（如果有）
            const accidentSample = items.find((i: any) => i.EventType === 1);
            if (accidentSample) {
              debug.roadEvent.accidentSample = sanitizeForDebug(accidentSample);
            }
            citySampleSaved = true;
          }

          const cityName = CITY_NAME[cityCode] || cityCode;
          for (const item of items) {
            const inc = parseRoadEventItem(item, cityName, "city");
            if (inc) {
              allIncidents.push(inc);
              cityAccidents++;
            }
          }
        } else {
          const errMsg = (result.reason as any)?.message || "unknown";
          if (errMsg === "rate-limited") {
            debug.roadEvent.rateLimited = true;
            break;
          }
          cityErrors[batch[batchResults.indexOf(result as any)] || "?"] = errMsg;
        }
      }
      if (debug.roadEvent.rateLimited) break;
    }

    debug.roadEvent.cityTotal = cityTotal;
    debug.roadEvent.cityByType = cityTypeCounts;
    debug.roadEvent.cityAccidents = cityAccidents;
    if (Object.keys(cityErrors).length > 0) {
      debug.roadEvent.cityErrors = cityErrors;
    }

    // 按時間排序
    allIncidents.sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
    );

    debug.roadEvent.totalIncidents = allIncidents.length;

    if (allIncidents.length > 0) {
      roadEventCache = {
        data: allIncidents,
        time: Date.now(),
        rawSample: debug.roadEvent.freewayRawSample || debug.roadEvent.cityRawSample,
      };
    }

    return { incidents: allIncidents, debug };
  } catch (err: any) {
    debug.roadEvent.error = err.message;
    return { incidents: roadEventCache?.data || [], debug };
  }
}

// 從各種可能的回應結構中提取事件陣列
function extractItems(data: any): any[] {
  if (Array.isArray(data)) return data;
  // TDX 常見的回應包裝
  if (data.RoadEvents && Array.isArray(data.RoadEvents)) return data.RoadEvents;
  if (data.LiveEvents && Array.isArray(data.LiveEvents)) return data.LiveEvents;
  if (data.Events && Array.isArray(data.Events)) return data.Events;
  if (data.RoadEventLiveList && Array.isArray(data.RoadEventLiveList)) return data.RoadEventLiveList;
  if (data.result && Array.isArray(data.result)) return data.result;
  // 嘗試找第一個陣列值
  for (const key of Object.keys(data)) {
    if (Array.isArray(data[key]) && data[key].length > 0) {
      return data[key];
    }
  }
  return [];
}

// 簡化物件供 debug 用（避免太大）
function sanitizeForDebug(item: any): any {
  const result: any = {};
  for (const [key, val] of Object.entries(item)) {
    if (typeof val === "string" && val.length > 150) {
      result[key] = val.slice(0, 150) + "...";
    } else if (typeof val === "object" && val !== null) {
      result[key] = JSON.stringify(val).slice(0, 100);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// 解析單一 RoadEvent 項目
function parseRoadEventItem(
  item: any,
  defaultCity: string,
  source: string
): Incident | null {
  // 判斷是否為事故
  if (!isAccidentEvent(item)) return null;

  // 提取座標
  const coords = extractCoords(item);
  const cityName = CITY_NAME[item.City] || item.CityName || defaultCity;
  const center = CITY_CENTER[cityName] || CITY_CENTER["國道"];

  let lat: number, lng: number;
  if (coords && coords.lat > 21 && coords.lat < 27 && coords.lng > 118 && coords.lng < 123) {
    lat = coords.lat;
    lng = coords.lng;
  } else {
    // 用城市中心 + hash 偏移
    const idStr = extractId(item);
    const hash = idStr.split("").reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
    lat = center.lat + ((hash % 100) - 50) * 0.002;
    lng = center.lng + (((hash * 7) % 100) - 50) * 0.002;
  }

  // 解析 Location JSON
  let locationInfo = "";
  let parsedLocation: any = null;
  if (item.Location && typeof item.Location === "string") {
    try {
      parsedLocation = JSON.parse(item.Location);
      if (parsedLocation.FreeExpressHighway) {
        const fw = parsedLocation.FreeExpressHighway;
        locationInfo = [fw.Road, fw.Direction, fw.StartKM].filter(Boolean).join(" ");
      } else if (parsedLocation.Other) {
        locationInfo = parsedLocation.Other;
      }
    } catch {}
  }

  // 解析 Impact JSON
  let impactInfo = "";
  if (item.Impact && typeof item.Impact === "string") {
    try {
      const impact = JSON.parse(item.Impact);
      if (impact.Description) impactInfo = impact.Description;
    } catch {}
  }

  // 組合描述
  const title = item.EventTitle || "";
  const rawDesc = item.Description || "";
  const road = extractRoad(item);

  // 建立豐富描述
  const descParts: string[] = [];

  // 如果描述很簡短（如「車禍」），嘗試補充更多資訊
  if (rawDesc.length <= 5) {
    // 用 Location + Impact 補充
    if (locationInfo) descParts.push(locationInfo);
    if (rawDesc && !descParts.some(p => p.includes(rawDesc))) descParts.push(rawDesc);
    if (impactInfo) descParts.push(impactInfo);
  } else {
    // 描述已經很豐富，直接使用
    descParts.push(rawDesc);
    if (locationInfo && !rawDesc.includes(locationInfo.slice(0, 10))) {
      descParts.push(locationInfo);
    }
  }

  const desc = descParts.filter(Boolean).join(" — ") || `${cityName} ${title}`;

  const eventTime = extractTime(item);

  return {
    id: `re-${extractId(item)}`,
    city: cityName,
    road: road,
    type: "交通事故",
    sev: guessSeverity(item),
    description: desc.slice(0, 200),
    lat,
    lng,
    time: eventTime,
    status: guessStatus(item),
    source: `tdx-roadevent-${source}`,
  };
}

// ===== 警廣即時路況（PBS）— 台灣 IP 限定，做為備用 =====
interface PBSItem {
  UID: string;
  region: string;
  areaNm: string;
  road: string;
  direction: string;
  roadtype: string;
  comment: string;
  happendate: string;
  happentime: string;
  modDttm: string;
  x1: string;
  y1: string;
}

let pbsCache: { data: Incident[]; time: number } | null = null;

async function fetchPBSIncidents(): Promise<{
  incidents: Incident[];
  debug: any;
}> {
  if (pbsCache && Date.now() - pbsCache.time < CACHE_TTL) {
    return {
      incidents: pbsCache.data,
      debug: { pbs: { cached: true, count: pbsCache.data.length } },
    };
  }

  const debug: any = { pbs: {} };
  try {
    const res = await fetch(
      "https://rtr.pbs.gov.tw/NMP103_PbsWS/resources/roadData/opendata",
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items: PBSItem[] = data.result || [];
    const accidents = items.filter((i) => i.roadtype === "事故");

    const now = new Date();
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayStr = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, "0")}-${String(twNow.getDate()).padStart(2, "0")}`;
    const todayAccidents = accidents.filter((i) => i.happendate === todayStr);

    const incidents: Incident[] = [];
    for (const item of todayAccidents) {
      const lat = parseFloat(item.y1);
      const lng = parseFloat(item.x1);
      if (!lat || !lng || lat < 21 || lat > 27 || lng < 118 || lng > 123) continue;

      incidents.push({
        id: `pbs-${item.UID}`,
        city: guessCityFromText(`${item.areaNm} ${item.comment} ${item.road}`, item.region),
        road: guessRoadFromText(`${item.areaNm} ${item.comment} ${item.road}`),
        type: "交通事故",
        sev: /死亡|罹難|身亡/.test(item.comment)
          ? "critical"
          : /重傷|翻覆|追撞|火燒|封閉/.test(item.comment)
          ? "major"
          : "minor",
        description: item.comment.slice(0, 200),
        lat,
        lng,
        time: `${item.happendate}T${item.happentime.split(".")[0]}+08:00`,
        status: /排除|恢復|開放通行|解除/.test(item.comment) ? "已排除" : "處理中",
        source: "pbs",
      });
    }

    incidents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    debug.pbs = { total: items.length, accidents: accidents.length, today: todayAccidents.length, parsed: incidents.length };
    if (incidents.length > 0) pbsCache = { data: incidents, time: Date.now() };
    return { incidents, debug };
  } catch (err: any) {
    debug.pbs = { error: err.message || "PBS 連線失敗（需台灣 IP）" };
    return { incidents: pbsCache?.data || [], debug };
  }
}

function guessCityFromText(text: string, region?: string): string {
  const cities = [
    "台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市",
    "基隆市", "新竹市", "苗栗縣", "彰化縣", "南投縣", "雲林縣",
    "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣",
  ];
  for (const c of cities) if (text.includes(c)) return c;
  const shortCities = ["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化", "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東"];
  for (const c of shortCities) if (text.includes(c)) return c + (["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "嘉義"].includes(c) ? "市" : "縣");
  if (text.includes("國道") || text.includes("高速公路")) return "國道";
  const regionMap: Record<string, string> = { N: "北部", M: "中部", S: "南部", E: "東部" };
  return (region && regionMap[region]) || "台灣";
}

function guessRoadFromText(text: string): string {
  const fw = text.match(/國道\d+號?/); if (fw) return fw[0];
  if (text.includes("福爾摩沙") || text.includes("國道3") || text.includes("國道３")) return "國道3號";
  if (text.includes("中山高") || text.includes("國道1") || text.includes("國道１")) return "國道1號";
  const hw = text.match(/台\d+[甲乙丙]?線/); if (hw) return hw[0];
  const rd = text.match(/([\u4e00-\u9fff]{2,6}(路|街|大道|橋|隧道|交流道)(\d*段)?)/);
  return rd ? rd[0] : "";
}

// ===== TDX News API（最後備用）=====
interface TDXNews {
  NewsID: string; Title: string; NewsCategory: number;
  Description: string; StartTime?: string; EndTime?: string;
  PublishTime?: string;
}

const NEWS_CITIES = ["Taipei", "NewTaipei", "Taoyuan", "Taichung", "Tainan", "Kaohsiung", "Keelung", "Hsinchu", "ChanghuaCounty", "PingtungCounty", "YilanCounty", "HualienCounty"];

let newsCache: { data: Incident[]; time: number } | null = null;

async function fetchTDXNewsIncidents(): Promise<{
  incidents: Incident[];
  debug: any;
}> {
  if (newsCache && Date.now() - newsCache.time < CACHE_TTL) {
    return { incidents: newsCache.data, debug: { news: { cached: true, count: newsCache.data.length } } };
  }

  const debug: any = { news: {} };
  try {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const results: Incident[] = [];

    for (const cityCode of NEWS_CITIES) {
      try {
        await new Promise((r) => setTimeout(r, 150));
        const res = await fetch(
          `https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/News/City/${cityCode}?%24top=50&%24format=JSON`,
          { headers, signal: AbortSignal.timeout(10000) }
        );
        if (res.status === 429) break;
        if (!res.ok) continue;
        const raw = await res.json();
        const newses: TDXNews[] = raw.Newses || (Array.isArray(raw) ? raw : []);
        const accidents = newses.filter((n) =>
          n.NewsCategory === 2 || /事故|車禍|撞|翻覆|自撞|追撞|碰撞|肇事|火燒車|死亡|傷亡/.test(`${n.Title} ${n.Description}`)
        );
        const city = CITY_NAME[cityCode] || "台灣";
        const center = CITY_CENTER[city] || CITY_CENTER["國道"];
        for (const n of accidents) {
          const hash = n.NewsID.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
          results.push({
            id: `tdx-news-${n.NewsID}`,
            city,
            road: guessRoadFromText(`${n.Title} ${n.Description}`),
            type: "交通事故",
            sev: /死亡|罹難/.test(`${n.Title}${n.Description}`) ? "critical" : /重傷|翻覆|追撞|火燒/.test(`${n.Title}${n.Description}`) ? "major" : "minor",
            description: (n.Title || n.Description || "").slice(0, 200),
            lat: center.lat + ((hash % 100) - 50) * 0.001,
            lng: center.lng + (((hash * 7) % 100) - 50) * 0.001,
            time: n.StartTime || n.PublishTime || new Date().toISOString(),
            status: n.EndTime || /已排除|恢復通行/.test(`${n.Title}${n.Description}`) ? "已排除" : "處理中",
            source: "tdx-news",
          });
        }
      } catch {}
    }

    // 今日篩選
    const now = new Date();
    const twNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const todayMidnightTW = new Date(twNow.getFullYear(), twNow.getMonth(), twNow.getDate()).getTime() - 8 * 60 * 60 * 1000;
    const today = results.filter((r) => new Date(r.time).getTime() >= todayMidnightTW);

    debug.news = { total: results.length, today: today.length };
    if (today.length > 0) newsCache = { data: today, time: Date.now() };
    return { incidents: today, debug };
  } catch (err: any) {
    debug.news = { error: err.message };
    return { incidents: newsCache?.data || [], debug };
  }
}

// ===== 合併 API =====
export async function GET() {
  try {
    // 同時抓三個資料源（RoadEvent 主力、PBS 備用、News 最後備用）
    const [roadEventResult, pbsResult, newsResult] = await Promise.all([
      fetchRoadEventIncidents(),
      fetchPBSIncidents(),
      fetchTDXNewsIncidents(),
    ]);

    // 合併（RoadEvent 優先 → PBS 補充 → News 最後補充）
    const allIncidents = [...roadEventResult.incidents];
    const seenIds = new Set(allIncidents.map((i) => i.id));

    // 加入 PBS（不重複）
    for (const inc of pbsResult.incidents) {
      if (seenIds.has(inc.id)) continue;
      // 檢查是否已有相近的事件
      const isDup = allIncidents.some((existing) => {
        const dist = Math.sqrt((existing.lat - inc.lat) ** 2 + (existing.lng - inc.lng) ** 2);
        const timeDiff = Math.abs(new Date(existing.time).getTime() - new Date(inc.time).getTime());
        return dist < 0.01 && timeDiff < 2 * 60 * 60 * 1000;
      });
      if (!isDup) {
        allIncidents.push(inc);
        seenIds.add(inc.id);
      }
    }

    // 加入 News（不重複）
    for (const inc of newsResult.incidents) {
      if (seenIds.has(inc.id)) continue;
      const isDup = allIncidents.some((existing) => {
        if (existing.city === inc.city && existing.road === inc.road && existing.road !== "") return true;
        const dist = Math.sqrt((existing.lat - inc.lat) ** 2 + (existing.lng - inc.lng) ** 2);
        const timeDiff = Math.abs(new Date(existing.time).getTime() - new Date(inc.time).getTime());
        return dist < 0.01 && timeDiff < 2 * 60 * 60 * 1000;
      });
      if (!isDup) {
        allIncidents.push(inc);
        seenIds.add(inc.id);
      }
    }

    // 按時間排序
    allIncidents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return NextResponse.json({
      incidents: allIncidents,
      total: allIncidents.length,
      updatedAt: new Date().toISOString(),
      sources: {
        roadEvent: roadEventResult.incidents.length,
        pbs: pbsResult.incidents.length,
        news: newsResult.incidents.length,
      },
      debug: {
        ...roadEventResult.debug,
        ...pbsResult.debug,
        ...newsResult.debug,
      },
    });
  } catch (err: any) {
    console.error("Incidents API error:", err);
    return NextResponse.json(
      { incidents: [], error: err.message || "事件取得失敗" },
      { status: 500 }
    );
  }
}

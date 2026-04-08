// src/components/TrafficMonitor.tsx
"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";

// ===== 型別 =====
interface Incident {
  id: number;
  city: string;
  road: string;
  type: string;
  sev: "critical" | "major" | "minor";
  time: Date;
  ts: string;
  ago: number;
  inv: string[];
  inj: number;
  fat: number;
  st: string;
  ln: string;
  lat: number;
  lng: number;
}

interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
}

interface CCTVItem {
  id: string;
  name: string;
  imageUrl: string;
  lat: number;
  lng: number;
  road: string;
  dist: number;
}

// ===== 常數 =====
const SL: Record<string, string> = { critical: "嚴重", major: "中度", minor: "輕微" };
const SC: Record<string, string> = { critical: "#ef4444", major: "#f59e0b", minor: "#3b82f6" };
// 城市及其中心座標 + 常見道路
const CITY_DATA: { name: string; lat: number; lng: number; roads: string[] }[] = [
  { name: "台北市", lat: 25.033, lng: 121.565, roads: ["忠孝東路", "信義路", "中山北路", "民生東路", "復興南路"] },
  { name: "新北市", lat: 25.012, lng: 121.465, roads: ["中正路", "中山路", "新莊中正路", "板橋文化路", "三重重新路"] },
  { name: "基隆市", lat: 25.128, lng: 121.739, roads: ["中正路", "仁愛路", "基金一路", "信二路"] },
  { name: "桃園市", lat: 24.994, lng: 121.301, roads: ["中正路", "復興路", "中山路", "國道1號", "國道2號"] },
  { name: "新竹市", lat: 24.804, lng: 120.969, roads: ["光復路", "中華路", "經國路", "東大路"] },
  { name: "苗栗縣", lat: 24.560, lng: 120.821, roads: ["中正路", "台1線", "國道1號", "中華路"] },
  { name: "台中市", lat: 24.148, lng: 120.674, roads: ["台灣大道", "中清路", "文心路", "國道1號", "五權路"] },
  { name: "彰化縣", lat: 24.052, lng: 120.516, roads: ["中山路", "中正路", "台1線", "國道1號"] },
  { name: "嘉義市", lat: 23.480, lng: 120.449, roads: ["中山路", "民族路", "忠孝路", "台1線"] },
  { name: "台南市", lat: 22.999, lng: 120.227, roads: ["中華東路", "成功路", "民族路", "國道1號", "台1線"] },
  { name: "高雄市", lat: 22.627, lng: 120.301, roads: ["中山路", "中正路", "民族路", "國道1號", "建國路"] },
  { name: "屏東縣", lat: 22.669, lng: 120.486, roads: ["中正路", "自由路", "台1線", "民生路"] },
  { name: "宜蘭縣", lat: 24.757, lng: 121.753, roads: ["中山路", "國道5號", "台9線", "民族路"] },
  { name: "花蓮縣", lat: 23.977, lng: 121.604, roads: ["中正路", "中山路", "台9線", "國道5號"] },
  { name: "台東縣", lat: 22.756, lng: 121.144, roads: ["中山路", "中華路", "台9線", "台11線"] },
];
const TYPES = ["追撞事故", "側撞事故", "機車摔車", "行人遭撞", "闖紅燈碰撞", "路口碰撞"];
const VEH = ["自小客車", "機車", "大貨車", "公車", "計程車"];

// 固定種子亂數（同一天產生相同資料，重整不會變動）
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateIncidents(): Incident[] {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const rand = seededRandom(seed);

  const sR = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
  const sP = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];

  const results: Incident[] = [];
  for (let i = 0; i < 25; i++) {
    const cityData = sP(CITY_DATA);
    const road = sP(cityData.roads);
    const s = rand() < 0.1 ? "critical" : rand() < 0.35 ? "major" : "minor";
    const ago = sR(0, 180);
    const t = new Date(Date.now() - ago * 60000);
    const nv = s === "critical" ? sR(3, 6) : s === "major" ? sR(2, 4) : sR(1, 2);
    // 在城市中心附近加上小偏移（±0.02 度≈±2km），模擬不同路段位置
    const lat = cityData.lat + (rand() - 0.5) * 0.04;
    const lng = cityData.lng + (rand() - 0.5) * 0.04;
    results.push({
      id: 1000 + i, city: cityData.name, road, type: sP(TYPES), sev: s as Incident["sev"],
      time: t, ts: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
      ago, inv: Array.from({ length: nv }, () => sP(VEH)),
      inj: s === "critical" ? sR(2, 8) : s === "major" ? sR(1, 3) : sR(0, 1),
      fat: s === "critical" ? sR(0, 2) : 0,
      st: ago < 15 ? "處理中" : ago < 45 ? "救援中" : "已排除",
      ln: s === "critical" ? "全線封閉" : s === "major" ? "部分封閉" : "路肩佔用",
      lat, lng,
    });
  }
  return results.sort((a, b) => a.ago - b.ago);
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
}

function extractCity(title: string): string {
  const cities = ["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化", "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東", "澎湖", "金門", "連江"];
  for (const c of cities) { if (title.includes(c)) return c; }
  return "台灣";
}

function getSeverity(title: string): "critical" | "major" | "minor" {
  if (/死亡|罹難|身亡|不治|喪命/.test(title)) return "critical";
  if (/重傷|酒駕|逆向|國道|高速/.test(title)) return "major";
  return "minor";
}

// ===== 台灣地圖（圖片 + 城市標記）=====
// 接收 incidents（模擬事故）來統計各縣市事故數
function TaiwanMap({ incidents, highlightCity }: { incidents: Incident[]; highlightCity: string | null }) {
  // 城市座標：基於 GPS 精確映射到 800×800 地圖圖片的百分比位置
  // 台灣本島像素範圍：x 199-436, y 96-703
  const cityPositions: Record<string, { x: number; y: number }> = {
    "基隆市": { x: 51, y: 16 },
    "台北市": { x: 48, y: 18 },
    "新北市": { x: 46, y: 19 },
    "桃園市": { x: 43, y: 19 },
    "新竹市": { x: 38, y: 23 },
    "新竹縣": { x: 38, y: 22 },
    "苗栗縣": { x: 35, y: 29 },
    "台中市": { x: 33, y: 38 },
    "彰化縣": { x: 30, y: 40 },
    "南投縣": { x: 33, y: 42 },
    "雲林縣": { x: 29, y: 47 },
    "嘉義市": { x: 29, y: 53 },
    "嘉義縣": { x: 31, y: 52 },
    "台南市": { x: 25, y: 63 },
    "高雄市": { x: 27, y: 72 },
    "屏東縣": { x: 30, y: 73 },
    "宜蘭縣": { x: 51, y: 24 },
    "花蓮縣": { x: 49, y: 41 },
    "台東縣": { x: 41, y: 69 },
  };

  // 統計各縣市事故數量
  const cityCount: Record<string, number> = {};
  incidents.forEach((inc) => {
    cityCount[inc.city] = (cityCount[inc.city] || 0) + 1;
  });

  // 統計各縣市嚴重事故數
  const cityCrit: Record<string, number> = {};
  incidents.forEach((inc) => {
    if (inc.sev === "critical") cityCrit[inc.city] = (cityCrit[inc.city] || 0) + 1;
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* 用圖片本身撐開容器，標記相對圖片定位 */}
      <div style={{ position: "relative", height: "100%", flexShrink: 0 }}>
        <img src="/taiwan-map.png" alt="台灣地圖" style={{ height: "100%", width: "auto", display: "block", opacity: 0.9 }} />
        {Object.entries(cityPositions).map(([city, pos]) => {
          const count = cityCount[city] || 0;
          const crit = cityCrit[city] || 0;
          const cityShort = city.slice(0, 2);
          const isHovered = highlightCity === cityShort;
          if (count === 0 && !isHovered) return null;
          const size = Math.min(16 + count * 4, 44);
          const color = isHovered ? "#ef4444" : crit > 0 ? "#ef4444" : count > 3 ? "#f59e0b" : "#3b82f6";
          return (
            <div key={city} style={{ position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none", zIndex: isHovered ? 10 : 1 }}>
              <div style={{ fontSize: isHovered ? 13 : 10, fontWeight: isHovered ? 700 : 500, color: isHovered ? "#f8fafc" : "#94a3b8", marginBottom: 2, textShadow: "0 0 6px rgba(0,0,0,0.9)", whiteSpace: "nowrap" }}>{cityShort}</div>
              <div style={{ position: "relative", width: size, height: size }}>
                <div style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `2px solid ${color}`, opacity: 0.5, animation: "pulse 2s ease-in-out infinite" }} />
                <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${isHovered ? 20 : 10}px ${color}66`, opacity: isHovered ? 1 : 0.85 }}>
                  <span style={{ color: "#fff", fontSize: size > 28 ? 13 : 11, fontWeight: 700 }}>{count}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.8); opacity: 0; } }`}</style>
    </div>
  );
}

// ===== CCTV 面板 =====
function CCTVPanel({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const { data, isLoading, error: swrError } = useSWR<{ cctvs: CCTVItem[]; error?: string; message?: string }>(
    `/api/cctv?lat=${incident.lat}&lng=${incident.lng}&road=${encodeURIComponent(incident.road)}&city=${encodeURIComponent(incident.city)}&count=4`,
    fetcher
  );
  const cctvs = data?.cctvs || [];
  const apiError = data?.error || data?.message || "";
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0d1220", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>📹 {incident.city} — {incident.road} 附近 CCTV</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{incident.type} · {incident.st} · {incident.ln}</div>
        </div>
        <button onClick={onClose} style={{ background: "#1e293b", border: "none", color: "#94a3b8", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {isLoading && (
          <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📹</div>
            正在取得 {incident.city} 附近的 CCTV 影像...
          </div>
        )}
        {swrError && (
          <div style={{ textAlign: "center", padding: 60, color: "#ef4444" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
            CCTV API 連線失敗，請稍後再試
          </div>
        )}
        {!isLoading && !swrError && cctvs.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
            {apiError || "此區域暫無可用的 CCTV 影像"}
          </div>
        )}
        {cctvs.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {cctvs.map((cctv) => (
                <div key={cctv.id} style={{ background: "#111827", borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b" }}>
                  <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#0a0e17" }}>
                    <img
                      src={`${cctv.imageUrl}${cctv.imageUrl.includes("?") ? "&" : "?"}t=${refreshKey}`}
                      alt={cctv.name}
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <div style={{ position: "absolute", top: 8, left: 8, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4 }}>● LIVE</div>
                  </div>
                  <div style={{ padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>{cctv.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{cctv.road} · {cctv.dist?.toFixed(1)}km</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button onClick={() => setRefreshKey((k) => k + 1)} style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>
                🔄 重新整理影像
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ===== 主元件 =====
export default function TrafficMonitor() {
  const { data: newsData, isLoading: newsLoading } = useSWR<NewsItem[]>("/api/news", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });

  const [incidents] = useState<Incident[]>(() => generateIncidents());
  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState<Date | null>(null);
  const [highlightCity, setHighlightCity] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const newsItems = Array.isArray(newsData) ? newsData : [];

  // 三小時內的新聞
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  const recentNews = newsItems.filter((n) => new Date(n.pubDate).getTime() > threeHoursAgo);

  const filtered = filter === "all" ? incidents : incidents.filter((i) => i.sev === filter);
  const critC = incidents.filter((i) => i.sev === "critical").length;
  const majC = incidents.filter((i) => i.sev === "major").length;
  const actC = incidents.filter((i) => i.st === "處理中").length;
  const totalInj = incidents.reduce((s, i) => s + i.inj + i.fat, 0);

  // 城市統計（從新聞）
  const rc: Record<string, number> = {};
  newsItems.forEach((n) => { const c = extractCity(n.title); rc[c] = (rc[c] || 0) + 1; });
  const topR = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxR = topR.length ? topR[0][1] : 1;

  const hourly = Array(24).fill(0);
  incidents.forEach((i) => { try { hourly[i.time.getHours()]++; } catch {} });
  const maxH = Math.max(...hourly, 1);

  const timeStr = now ? now.toLocaleString("zh-TW", { hour12: false }) : "載入中...";

  const s = {
    root: { height: "100vh", display: "flex", background: "#0a0e17", color: "#e2e8f0", fontFamily: "system-ui, -apple-system, sans-serif", overflow: "hidden" } as React.CSSProperties,
    sidebar: { width: 340, display: "flex", flexDirection: "column" as const, borderRight: "1px solid #1e293b", background: "#0f1525" } as React.CSSProperties,
    header: { padding: "16px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    title: { fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
    subtitle: { fontSize: 12, color: "#64748b", marginTop: 4 } as React.CSSProperties,
    filterBar: { display: "flex", gap: 6, padding: "12px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    filterBtn: (active: boolean) => ({ padding: "4px 12px", fontSize: 12, borderRadius: 20, border: "1px solid " + (active ? "#3b82f6" : "#334155"), background: active ? "#1e3a5f" : "transparent", color: active ? "#93c5fd" : "#94a3b8", cursor: "pointer" }) as React.CSSProperties,
    list: { flex: 1, overflowY: "auto" as const, padding: "8px 12px" } as React.CSSProperties,
    card: (isActive: boolean) => ({ padding: "10px 12px", marginBottom: 6, borderRadius: 8, background: isActive ? "#1e3a5f" : "#111827", border: `1px solid ${isActive ? "#3b82f6" : "#1e293b"}`, cursor: "pointer", transition: "all 0.2s" }) as React.CSSProperties,
    badge: (sev: string) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: SC[sev] + "22", color: SC[sev] }) as React.CSSProperties,
    center: { flex: 1, display: "flex", flexDirection: "column" as const } as React.CSSProperties,
    topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #1e293b", background: "#0d1220", flexShrink: 0 } as React.CSSProperties,
    stats: { width: 280, borderLeft: "1px solid #1e293b", background: "#0f1525", padding: 20, overflowY: "auto" as const } as React.CSSProperties,
    statCard: { background: "#111827", borderRadius: 8, padding: "12px 16px", marginBottom: 12 } as React.CSSProperties,
  };

  return (
    <div style={s.root}>
      {/* ===== 左側：事故列表 ===== */}
      <div style={s.sidebar}>
        <div style={s.header}>
          <h1 style={s.title}><span style={{ fontSize: 22 }}>🚨</span> TrafficWatch</h1>
          <div style={s.subtitle}>台灣即時交通事故監控 — {timeStr}</div>
        </div>
        <div style={s.filterBar}>
          {[["all", "全部"], ["critical", "嚴重"], ["major", "中度"], ["minor", "輕微"]].map(([k, label]) => (
            <button key={k} style={s.filterBtn(filter === k)} onClick={() => setFilter(k)}>
              {label} {k === "all" ? `(${incidents.length})` : `(${incidents.filter(i => i.sev === k).length})`}
            </button>
          ))}
        </div>
        <div style={s.list}>
          {filtered.map((inc) => {
            const isActive = selectedIncident?.id === inc.id;
            const cityShort = inc.city.slice(0, 2);
            return (
              <div
                key={inc.id}
                style={s.card(isActive)}
                onClick={() => setSelectedIncident(isActive ? null : inc)}
                onMouseEnter={() => setHighlightCity(cityShort)}
                onMouseLeave={() => setHighlightCity(null)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={s.badge(inc.sev)}>{SL[inc.sev]}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{inc.ts} ({inc.ago}分前)</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{inc.city} — {inc.road}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{inc.type} · {inc.st} · {inc.ln}</div>
                <div style={{ fontSize: 11, color: isActive ? "#3b82f6" : "#475569", marginTop: 4 }}>
                  {isActive ? "📹 CCTV 顯示中" : "📹 點擊查看附近 CCTV"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== 中間：CCTV 面板 或 地圖+新聞 ===== */}
      <div style={s.center}>
        {selectedIncident ? (
          /* CCTV 模式 */
          <>
            <div style={s.topBar}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>📹 即時 CCTV 影像</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{selectedIncident.city} 附近攝影機</span>
              </div>
              <button onClick={() => setSelectedIncident(null)} style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "4px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>🗺️ 返回地圖</button>
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <CCTVPanel incident={selectedIncident} onClose={() => setSelectedIncident(null)} />
            </div>
          </>
        ) : (
          /* 地圖 + 三小時內新聞 */
          <>
            <div style={s.topBar}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>🗺️ 台灣交通事故地圖</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {newsItems.length > 0 ? `今日 ${newsItems.length} 則事故新聞` : "載入中..."}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#475569" }}>每 5 分鐘自動更新</div>
            </div>
            {/* 上半：地圖 */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "#070b14", overflow: "hidden", minHeight: 0 }}>
              {newsLoading ? (
                <div style={{ color: "#475569", textAlign: "center" }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🗺️</div>載入地圖中...
                </div>
              ) : (
                <TaiwanMap incidents={incidents} highlightCity={highlightCity} />
              )}
            </div>
            {/* 下半：三小時內新聞 */}
            <div style={{ height: 240, flexShrink: 0, borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 20px", background: "#0d1220", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>📰 三小時內交通事故新聞</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  {recentNews.length} 則
                </span>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
                {newsLoading && <div style={{ textAlign: "center", padding: 20, color: "#475569", fontSize: 13 }}>載入新聞中...</div>}
                {!newsLoading && recentNews.length === 0 && (
                  <div style={{ textAlign: "center", padding: 20, color: "#475569", fontSize: 13 }}>三小時內暫無相關新聞</div>
                )}
                {recentNews.map((news, i) => {
                  const sev = getSeverity(news.title);
                  return (
                    <a key={i} href={news.link} target="_blank" rel="noopener noreferrer"
                      style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #1e293b22", textDecoration: "none", color: "inherit" }}>
                      <span style={{ ...s.badge(sev), flexShrink: 0, marginTop: 2 }}>{SL[sev]}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{news.title}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 11, color: "#64748b" }}>
                          <span style={{ color: "#3b82f6" }}>{news.source}</span>
                          <span>{timeAgo(news.pubDate)}</span>
                        </div>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== 右側：統計 ===== */}
      <div style={s.stats}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginTop: 0, marginBottom: 16, letterSpacing: 1 }}>即時統計</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            { label: "事故總數", val: incidents.length, color: "#f8fafc" },
            { label: "嚴重事故", val: critC, color: "#ef4444" },
            { label: "中度事故", val: majC, color: "#f59e0b" },
            { label: "處理中", val: actC, color: "#22c55e" },
          ].map((c) => (
            <div key={c.label} style={s.statCard}>
              <div style={{ fontSize: 11, color: "#64748b" }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>累計傷亡</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>{totalInj} 人</div>
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>24 小時事故趨勢</div>
          <svg width="100%" height={60} viewBox="0 0 240 60" preserveAspectRatio="none">
            {hourly.map((h, i) => (
              <rect key={i} x={i * 10} y={60 - (h / maxH) * 55} width={8} height={(h / maxH) * 55}
                rx={2} fill={now && i === now.getHours() ? "#3b82f6" : "#1e293b"} />
            ))}
          </svg>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", marginTop: 2 }}>
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>新聞事故熱區</div>
          {topR.length === 0 && <div style={{ fontSize: 12, color: "#475569" }}>載入中...</div>}
          {topR.map(([city, count]) => (
            <div key={city} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#94a3b8", width: 48, flexShrink: 0 }}>{city}</span>
              <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(count / maxR) * 100}%`, height: "100%", background: "#3b82f6", borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 11, color: "#64748b", width: 20, textAlign: "right" as const }}>{count}</span>
            </div>
          ))}
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>嚴重程度分佈</div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
            {incidents.length > 0 && (<>
              <div style={{ width: `${(critC / incidents.length) * 100}%`, background: "#ef4444" }} />
              <div style={{ width: `${(majC / incidents.length) * 100}%`, background: "#f59e0b" }} />
              <div style={{ width: `${((incidents.length - critC - majC) / incidents.length) * 100}%`, background: "#3b82f6" }} />
            </>)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
            <span>嚴重 {critC}</span><span>中度 {majC}</span><span>輕微 {incidents.length - critC - majC}</span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#475569", marginTop: 12, lineHeight: 1.5 }}>
          新聞來源：Google News<br />
          CCTV 來源：TDX 交通部<br />
          {newsItems.length > 0 ? `✅ 已載入 ${newsItems.length} 則今日新聞` : "⏳ 新聞載入中..."}
        </div>
      </div>
    </div>
  );
}

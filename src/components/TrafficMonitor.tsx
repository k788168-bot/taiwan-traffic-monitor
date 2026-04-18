// src/components/TrafficMonitor.tsx
"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";

// ===== 型別 =====
interface Incident {
  id: string;
  city: string;
  road: string;
  type: string;
  sev: "critical" | "major" | "minor";
  description: string;
  lat: number;
  lng: number;
  time: string; // ISO string
  status: string;
  source: string;
  // 前端計算
  ts?: string;
  ago?: number;
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
  type: "image" | "stream";
  lat: number;
  lng: number;
  road: string;
  dist: number;
}

// ===== 常數 =====
const SL: Record<string, string> = { critical: "嚴重", major: "中度", minor: "輕微" };
const SC: Record<string, string> = { critical: "#ef4444", major: "#f59e0b", minor: "#3b82f6" };
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

// ===== CCTV 影像（圖片走代理，串流用 iframe）=====
function CCTVImage({ url, alt, type, refreshKey }: { url: string; alt: string; type: "image" | "stream"; refreshKey: number }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => { setFailed(false); }, [url, refreshKey]);

  // 串流類型（HTML 頁面）→ 用 iframe 嵌入
  if (type === "stream") {
    return (
      <iframe
        src={url}
        title={alt}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
        allow="autoplay"
        loading="lazy"
      />
    );
  }

  // 圖片類型 → 用 img + 代理
  if (failed) {
    return (
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12, flexDirection: "column", gap: 4 }}>
        <span>影像載入失敗</span>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", fontSize: 11 }}>開啟原始連結</a>
      </div>
    );
  }

  return (
    <img
      src={`/api/cctv-image?url=${encodeURIComponent(url)}&t=${refreshKey}`}
      alt={alt}
      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
      onError={() => setFailed(true)}
    />
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
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{incident.type} · {incident.status}</div>
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
                    <CCTVImage url={cctv.imageUrl} alt={cctv.name} type={cctv.type || "image"} refreshKey={refreshKey} />
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

// ===== Google Map 嵌入（用描述中的地址搜尋，更精確定位）=====
function IncidentMap({ incident, height }: { incident: Incident; height?: string }) {
  // 從描述中提取地址關鍵字（區名+路名+號），比單純城市+路名更精確
  const desc = incident.description || "";
  const addrMatch = desc.match(/([\u4e00-\u9fff]{1,3}區[\u4e00-\u9fff\d]+(?:路|街|大道|巷|弄|號)[\u4e00-\u9fff\d]*)/);
  const roadMatch = desc.match(/(國\d+[南北]向[\u4e00-\u9fff]*|台\d+[甲乙丙]?線[\u4e00-\u9fff]*|[\u4e00-\u9fff]{2,6}(?:路|街|大道|橋)[\d]*段?)/);
  const searchTerm = addrMatch ? addrMatch[0] : (roadMatch ? roadMatch[0] : incident.road);
  const query = encodeURIComponent(`台灣 ${incident.city} ${searchTerm}`);
  const mapSrc = `https://maps.google.com/maps?q=${query}&z=15&output=embed&hl=zh-TW`;
  return (
    <iframe
      src={mapSrc}
      style={{ width: "100%", height: height || "100%", border: "none", borderRadius: 8 }}
      allowFullScreen
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

// ===== 處理中事故地圖面板 =====
function ActiveMapGrid({ incidents }: { incidents: Incident[] }) {
  const activeIncidents = incidents.filter((i) => i.status === "處理中").slice(0, 4);

  if (activeIncidents.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 15 }}>目前沒有正在處理中的事故</div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: activeIncidents.length === 1 ? "1fr" : "1fr 1fr", gap: 10, height: "100%" }}>
      {activeIncidents.map((inc) => (
        <div key={inc.id} style={{ background: "#111827", borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Google Map */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <IncidentMap incident={inc} />
          </div>
          {/* 事故資訊 */}
          <div style={{ padding: "6px 10px", borderTop: "1px solid #1e293b", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, fontWeight: 700, color: "#fff", background: inc.sev === "critical" ? "#dc2626" : inc.sev === "major" ? "#d97706" : "#2563eb" }}>
                {SL[inc.sev]}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{inc.city} — {inc.road}</span>
            </div>
            <div style={{ fontSize: 11, color: "#64748b" }}>{inc.type} · {inc.status}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== 主元件 =====
export default function TrafficMonitor() {
  const { data: newsData, isLoading: newsLoading } = useSWR<NewsItem[]>("/api/news", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });

  // 從 TDX API 取得即時事故資料（每 2 分鐘更新）
  const { data: incData, isLoading: incLoading } = useSWR<{ incidents: Incident[]; total: number; updatedAt: string }>(
    "/api/incidents", fetcher, { refreshInterval: 120000, revalidateOnFocus: true }
  );

  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState<Date | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 處理即時事故資料，計算 ago 和 ts
  const incidents: Incident[] = (incData?.incidents || []).map((inc) => {
    const t = new Date(inc.time);
    const ago = Math.floor((Date.now() - t.getTime()) / 60000);
    return {
      ...inc,
      ts: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
      ago: Math.max(0, ago),
    };
  });

  const newsItems = Array.isArray(newsData) ? newsData : [];

  // 三小時內的新聞
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  const recentNews = newsItems.filter((n) => new Date(n.pubDate).getTime() > threeHoursAgo);

  const filtered = filter === "all" ? incidents : incidents.filter((i) => i.sev === filter);
  const critC = incidents.filter((i) => i.sev === "critical").length;
  const majC = incidents.filter((i) => i.sev === "major").length;
  const actC = incidents.filter((i) => i.status === "處理中").length;
  // TDX API 不提供傷亡人數，改為統計事故來源
  const sourceCount = { freeway: 0, highway: 0, city: 0 };
  incidents.forEach((i) => { if (i.source in sourceCount) sourceCount[i.source as keyof typeof sourceCount]++; });

  // 城市統計（從新聞）
  const rc: Record<string, number> = {};
  newsItems.forEach((n) => { const c = extractCity(n.title); if (c !== "台灣") rc[c] = (rc[c] || 0) + 1; });
  const topR = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxR = topR.length ? topR[0][1] : 1;

  const hourly = Array(24).fill(0);
  incidents.forEach((i) => { try { hourly[new Date(i.time).getHours()]++; } catch {} });
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
          {incLoading && (
            <div style={{ textAlign: "center", padding: 40, color: "#475569", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
              正在從 TDX 取得即時事故資料...
            </div>
          )}
          {!incLoading && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#475569", fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              目前無{filter === "all" ? "" : SL[filter]}事故資料
            </div>
          )}
          {filtered.map((inc) => {
            const isActive = selectedIncident?.id === inc.id;
            return (
              <div
                key={inc.id}
                style={s.card(isActive)}
                onClick={() => setSelectedIncident(isActive ? null : inc)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={s.badge(inc.sev)}>{SL[inc.sev]}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{inc.ts} ({inc.ago}分前)</span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{inc.city} — {inc.road}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{inc.type} · {inc.status}</div>
                <div style={{ fontSize: 11, color: isActive ? "#3b82f6" : "#475569", marginTop: 4 }}>
                  {isActive ? "📍 地圖 + CCTV 顯示中" : "📍 點擊查看地圖與 CCTV"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== 中間：事故地圖 + 新聞 ===== */}
      <div style={s.center}>
        {selectedIncident ? (
          /* 點擊特定事故 → 上方 Google Map + 下方 CCTV */
          <>
            <div style={s.topBar}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>📍 {selectedIncident.city} — {selectedIncident.road}</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{selectedIncident.type} · {selectedIncident.status}</span>
              </div>
              <button onClick={() => setSelectedIncident(null)} style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "4px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← 返回即時監控</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", background: "#070b14", display: "flex", flexDirection: "column", minHeight: 0 }}>
              {/* 上半：Google Map */}
              <div style={{ flexShrink: 0, height: "45%", minHeight: 200, padding: "12px 12px 6px 12px" }}>
                <div style={{ height: "100%", borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b" }}>
                  <IncidentMap incident={selectedIncident} />
                </div>
              </div>
              {/* 下半：CCTV */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <CCTVPanel incident={selectedIncident} onClose={() => setSelectedIncident(null)} />
              </div>
            </div>
          </>
        ) : (
          /* 預設：處理中事故的地圖 + 新聞 */
          <>
            <div style={s.topBar}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>📍 事故即時監控</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  處理中事故半徑 3 公里地圖
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#475569" }}>點擊左側事故查看詳情</div>
            </div>
            {/* 上半：處理中事故地圖 */}
            <div style={{ flex: 1, overflow: "auto", padding: 12, background: "#070b14", minHeight: 0 }}>
              <ActiveMapGrid incidents={incidents} />
            </div>
            {/* 下半：三小時內新聞 */}
            <div style={{ height: 220, flexShrink: 0, borderTop: "1px solid #1e293b", display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "10px 20px", background: "#0d1220", borderBottom: "1px solid #1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc" }}>📰 三小時內交通事故新聞</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{recentNews.length} 則</span>
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
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginTop: 0, marginBottom: 16, letterSpacing: 1 }}>當日統計</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            { label: "今日事故總數", val: incidents.length, color: "#f8fafc" },
            { label: "嚴重事故", val: critC, color: "#ef4444" },
            { label: "中度事故", val: majC, color: "#f59e0b" },
            { label: "輕微事故", val: incidents.length - critC - majC, color: "#3b82f6" },
          ].map((c) => (
            <div key={c.label} style={s.statCard}>
              <div style={{ fontSize: 11, color: "#64748b" }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div style={s.statCard}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>國道/省道</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#ef4444" }}>{sourceCount.freeway + sourceCount.highway} 件</div>
          </div>
          <div style={s.statCard}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>處理中</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#22c55e" }}>{actC} 件</div>
          </div>
        </div>
        <div style={s.statCard}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>今日事故時段分佈</div>
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
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>今日事故熱區</div>
          {(() => {
            const ic: Record<string, number> = {};
            incidents.forEach((inc) => { const c = inc.city.slice(0, 2); ic[c] = (ic[c] || 0) + 1; });
            const topI = Object.entries(ic).sort((a, b) => b[1] - a[1]).slice(0, 6);
            const maxI = topI.length ? topI[0][1] : 1;
            return topI.map(([city, count]) => (
              <div key={city} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#94a3b8", width: 48, flexShrink: 0 }}>{city}</span>
                <div style={{ flex: 1, height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${(count / maxI) * 100}%`, height: "100%", background: "#3b82f6", borderRadius: 3 }} />
                </div>
                <span style={{ fontSize: 11, color: "#64748b", width: 20, textAlign: "right" as const }}>{count}</span>
              </div>
            ));
          })()}
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
          事故來源：TDX 即時交通事件<br />
          新聞來源：Google News<br />
          CCTV 來源：TDX 交通部<br />
          {incLoading ? "⏳ 事故資料載入中..." : `✅ 已載入 ${incidents.length} 筆即時事故`}<br />
          {newsItems.length > 0 ? `✅ 已載入 ${newsItems.length} 則今日新聞` : "⏳ 新聞載入中..."}
          {incData?.updatedAt && <><br />最後更新：{new Date(incData.updatedAt).toLocaleTimeString("zh-TW", { hour12: false })}</>}
        </div>
      </div>
    </div>
  );
}

// src/components/TrafficMonitor.tsx
"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";

// ===== 型別 =====
interface Incident {
  id: number | string;
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
}

interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
}

// ===== 常數 =====
const SL: Record<string, string> = { critical: "嚴重", major: "中度", minor: "輕微" };
const SC: Record<string, string> = { critical: "#ef4444", major: "#f59e0b", minor: "#3b82f6" };

// ===== 模擬資料 =====
const CITIES = [
  { n: "台北市" }, { n: "新北市" }, { n: "台中市" },
  { n: "高雄市" }, { n: "台南市" }, { n: "桃園市" },
];
const ROADS = ["國道1號", "國道3號", "台1線", "中山路", "中正路", "忠孝東路", "信義路"];
const TYPES = ["追撞事故", "側撞事故", "機車摔車", "行人遭撞", "闖紅燈碰撞", "路口碰撞"];
const VEH = ["自小客車", "機車", "大貨車", "公車", "計程車"];

const R = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const P = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

let nid = 1000;
function mockIncident(): Incident {
  const c = P(CITIES);
  const s = Math.random() < 0.1 ? "critical" : Math.random() < 0.35 ? "major" : "minor";
  const ago = R(0, 120);
  const t = new Date(Date.now() - ago * 60000);
  const nv = s === "critical" ? R(3, 6) : s === "major" ? R(2, 4) : R(1, 2);
  return {
    id: nid++, city: c.n,
    road: P(ROADS), type: P(TYPES), sev: s as Incident["sev"],
    time: t, ts: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`,
    ago, inv: Array.from({ length: nv }, () => P(VEH)),
    inj: s === "critical" ? R(2, 8) : s === "major" ? R(1, 3) : R(0, 1),
    fat: s === "critical" ? R(0, 2) : 0,
    st: ago < 15 ? "處理中" : ago < 45 ? "救援中" : "已排除",
    ln: s === "critical" ? "全線封閉" : s === "major" ? "部分封閉" : "路肩佔用",
  };
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

// ===== 主元件 =====
export default function TrafficMonitor() {
  const { data: newsData, error: newsError, isLoading: newsLoading } = useSWR<NewsItem[]>("/api/news", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });

  const [incidents, setIncidents] = useState<Incident[]>(
    () => Array.from({ length: 20 }, mockIncident).sort((a, b) => a.ago - b.ago)
  );
  const [filter, setFilter] = useState("all");
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const schedule = () => setTimeout(() => {
      const inc = mockIncident();
      inc.ago = 0; inc.st = "處理中";
      setIncidents((prev) => [inc, ...prev].slice(0, 60));
      setToast(`${inc.city} ${inc.road} — ${inc.type}`);
      setTimeout(() => setToast(null), 3500);
      ref.current = schedule();
    }, R(8000, 18000));
    const ref = { current: schedule() };
    return () => clearTimeout(ref.current);
  }, []);

  const filtered = filter === "all" ? incidents : incidents.filter((i) => i.sev === filter);
  const critC = incidents.filter((i) => i.sev === "critical").length;
  const majC = incidents.filter((i) => i.sev === "major").length;
  const actC = incidents.filter((i) => i.st === "處理中").length;
  const totalInj = incidents.reduce((s, i) => s + i.inj + i.fat, 0);
  const hourly = Array(24).fill(0);
  incidents.forEach((i) => { try { hourly[i.time.getHours()]++; } catch {} });
  const maxH = Math.max(...hourly, 1);
  const rc: Record<string, number> = {};
  incidents.forEach((i) => (rc[i.city] = (rc[i.city] || 0) + 1));
  const topR = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxR = topR.length ? topR[0][1] : 1;
  const timeStr = now ? now.toLocaleString("zh-TW", { hour12: false }) : "載入中...";
  const newsItems = Array.isArray(newsData) ? newsData : [];

  const s = {
    root: { height: "100vh", display: "flex", background: "#0a0e17", color: "#e2e8f0", fontFamily: "system-ui, -apple-system, sans-serif", overflow: "hidden" } as React.CSSProperties,
    sidebar: { width: 340, display: "flex", flexDirection: "column" as const, borderRight: "1px solid #1e293b", background: "#0f1525" } as React.CSSProperties,
    header: { padding: "16px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    title: { fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
    subtitle: { fontSize: 12, color: "#64748b", marginTop: 4 } as React.CSSProperties,
    filterBar: { display: "flex", gap: 6, padding: "12px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    filterBtn: (active: boolean) => ({ padding: "4px 12px", fontSize: 12, borderRadius: 20, border: "1px solid " + (active ? "#3b82f6" : "#334155"), background: active ? "#1e3a5f" : "transparent", color: active ? "#93c5fd" : "#94a3b8", cursor: "pointer" }) as React.CSSProperties,
    list: { flex: 1, overflowY: "auto" as const, padding: "8px 12px" } as React.CSSProperties,
    card: (sev: string) => ({ padding: "10px 12px", marginBottom: 6, borderRadius: 8, background: "#111827", border: "1px solid #1e293b" }) as React.CSSProperties,
    badge: (sev: string) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: SC[sev] + "22", color: SC[sev] }) as React.CSSProperties,
    center: { flex: 1, display: "flex", flexDirection: "column" as const } as React.CSSProperties,
    topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #1e293b", background: "#0d1220" } as React.CSSProperties,
    newsWrap: { flex: 1, overflowY: "auto" as const, padding: "20px", background: "#070b14" } as React.CSSProperties,
    stats: { width: 280, borderLeft: "1px solid #1e293b", background: "#0f1525", padding: 20, overflowY: "auto" as const } as React.CSSProperties,
    statCard: { background: "#111827", borderRadius: 8, padding: "12px 16px", marginBottom: 12 } as React.CSSProperties,
    toastStyle: { position: "fixed" as const, top: 20, left: "50%", transform: "translateX(-50%)", background: "#dc2626", color: "#fff", padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 20px rgba(220,38,38,.4)" } as React.CSSProperties,
    newsCard: { padding: "16px", marginBottom: 12, borderRadius: 10, background: "#111827", border: "1px solid #1e293b", transition: "border-color .2s" } as React.CSSProperties,
  };

  return (
    <div style={s.root}>
      {toast && <div style={s.toastStyle}>⚠ 新事故通報：{toast}</div>}

      {/* 左側欄 */}
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
          {filtered.map((inc) => (
            <div key={inc.id} style={s.card(inc.sev)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={s.badge(inc.sev)}>{SL[inc.sev]}</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{inc.ts} ({inc.ago}分前)</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{inc.city} — {inc.road}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{inc.type} · {inc.st} · {inc.ln}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 中央：今日交通事故新聞 */}
      <div style={s.center}>
        <div style={s.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>📰 今日交通事故新聞</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {newsItems.length > 0 ? `${newsItems.length} 則相關報導` : "搜尋中..."}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#475569" }}>每 5 分鐘自動更新</div>
        </div>
        <div style={s.newsWrap}>
          {newsLoading && (
            <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              正在搜尋今日交通事故新聞...
            </div>
          )}
          {newsError && !newsItems.length && (
            <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
              無法載入新聞，請稍後重試
            </div>
          )}
          {!newsLoading && newsItems.length === 0 && !newsError && (
            <div style={{ textAlign: "center", padding: 60, color: "#475569" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              今日暫無相關交通事故新聞
            </div>
          )}
          {newsItems.map((news, i) => (
            <a key={i} href={news.link} target="_blank" rel="noopener noreferrer"
              style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={s.newsCard}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#334155"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#1e293b"; }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.5, marginBottom: 6 }}>
                  {news.title}
                </div>
                {news.description && (
                  <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 8 }}>
                    {news.description.slice(0, 120)}{news.description.length > 120 ? "..." : ""}
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#64748b" }}>
                  {news.source && <span style={{ color: "#3b82f6" }}>{news.source}</span>}
                  <span>{timeAgo(news.pubDate)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* 右側欄 */}
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
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>事故熱區</div>
          {topR.map(([city, count]) => (
            <div key={city} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "#94a3b8", width: 60, flexShrink: 0 }}>{city}</span>
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
          {newsItems.length > 0 ? `✅ 已載入 ${newsItems.length} 則今日新聞` : "⏳ 新聞載入中..."}
        </div>
      </div>
    </div>
  );
}

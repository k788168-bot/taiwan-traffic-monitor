// src/components/TrafficMonitor.tsx
"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";

// ===== 型別 =====
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
  for (const c of cities) {
    if (title.includes(c)) return c;
  }
  return "台灣";
}

function getSeverity(title: string): "critical" | "major" | "minor" {
  if (/死亡|罹難|身亡|不治|喪命/.test(title)) return "critical";
  if (/重傷|酒駕|逆向|國道|高速/.test(title)) return "major";
  return "minor";
}

// 從標題提取事故類型
function extractType(title: string): string {
  if (/車禍|追撞|撞/.test(title)) return "車禍事故";
  if (/酒駕/.test(title)) return "酒駕事故";
  if (/行人/.test(title)) return "行人事故";
  if (/機車/.test(title)) return "機車事故";
  if (/死亡|罹難/.test(title)) return "死亡事故";
  return "交通事故";
}

// ===== 台灣地圖（圖片 + 城市標記）=====
function TaiwanMap({ newsItems, highlightCity }: { newsItems: NewsItem[]; highlightCity: string | null }) {
  const cityPositions: Record<string, { x: number; y: number }> = {
    "台北": { x: 46, y: 14 }, "新北": { x: 50, y: 18 }, "基隆": { x: 54, y: 12 },
    "桃園": { x: 40, y: 22 }, "新竹": { x: 37, y: 28 }, "苗栗": { x: 35, y: 34 },
    "台中": { x: 32, y: 42 }, "彰化": { x: 28, y: 48 }, "南投": { x: 36, y: 48 },
    "雲林": { x: 26, y: 54 }, "嘉義": { x: 28, y: 59 }, "台南": { x: 26, y: 66 },
    "高雄": { x: 30, y: 74 }, "屏東": { x: 36, y: 82 }, "宜蘭": { x: 54, y: 22 },
    "花蓮": { x: 50, y: 42 }, "台東": { x: 44, y: 64 }, "澎湖": { x: 12, y: 55 },
    "台灣": { x: 38, y: 50 },
  };

  const cityCount: Record<string, number> = {};
  newsItems.forEach((n) => {
    const c = extractCity(n.title);
    cityCount[c] = (cityCount[c] || 0) + 1;
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <img
        src="/taiwan-map.png"
        alt="台灣地圖"
        style={{ maxHeight: "calc(100vh - 100px)", maxWidth: "100%", objectFit: "contain", opacity: 0.9 }}
      />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
        {Object.entries(cityPositions).map(([city, pos]) => {
          const count = cityCount[city] || 0;
          const isHovered = highlightCity === city;
          if (count === 0 && !isHovered) return null;
          const size = Math.min(14 + count * 6, 40);
          return (
            <div key={city} style={{
              position: "absolute", left: `${pos.x}%`, top: `${pos.y}%`,
              transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column",
              alignItems: "center", pointerEvents: "none",
            }}>
              <div style={{
                fontSize: isHovered ? 13 : 11, fontWeight: isHovered ? 700 : 500,
                color: isHovered ? "#f8fafc" : "#94a3b8", marginBottom: 2,
                textShadow: "0 0 6px rgba(0,0,0,0.8)", whiteSpace: "nowrap",
              }}>{city}</div>
              <div style={{ position: "relative", width: size, height: size }}>
                <div style={{
                  position: "absolute", inset: -4, borderRadius: "50%",
                  border: `2px solid ${isHovered ? "#ef4444" : "#f59e0b"}`,
                  opacity: 0.5, animation: "pulse 2s ease-in-out infinite",
                }} />
                <div style={{
                  width: size, height: size, borderRadius: "50%",
                  background: isHovered ? "#ef4444" : count > 2 ? "#ef4444" : "#f59e0b",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 0 ${isHovered ? 20 : 10}px ${isHovered ? "#ef4444" : "#f59e0b"}66`,
                  opacity: isHovered ? 1 : 0.9,
                }}>
                  <span style={{ color: "#fff", fontSize: size > 24 ? 13 : 11, fontWeight: 700 }}>{count}</span>
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

// ===== 主元件 =====
export default function TrafficMonitor() {
  const { data: newsData, isLoading: newsLoading } = useSWR<NewsItem[]>("/api/news", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });

  const [filter, setFilter] = useState("all");
  const [now, setNow] = useState<Date | null>(null);
  const [highlightCity, setHighlightCity] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const newsItems = Array.isArray(newsData) ? newsData : [];

  // 根據嚴重程度篩選
  const filtered = filter === "all"
    ? newsItems
    : newsItems.filter((n) => getSeverity(n.title) === filter);

  const critC = newsItems.filter((n) => getSeverity(n.title) === "critical").length;
  const majC = newsItems.filter((n) => getSeverity(n.title) === "major").length;
  const minC = newsItems.length - critC - majC;

  // 城市統計
  const rc: Record<string, number> = {};
  newsItems.forEach((n) => {
    const c = extractCity(n.title);
    rc[c] = (rc[c] || 0) + 1;
  });
  const topR = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxR = topR.length ? topR[0][1] : 1;

  const timeStr = now ? now.toLocaleString("zh-TW", { hour12: false }) : "載入中...";

  const s = {
    root: { height: "100vh", display: "flex", background: "#0a0e17", color: "#e2e8f0", fontFamily: "system-ui, -apple-system, sans-serif", overflow: "hidden" } as React.CSSProperties,
    sidebar: { width: 360, display: "flex", flexDirection: "column" as const, borderRight: "1px solid #1e293b", background: "#0f1525" } as React.CSSProperties,
    header: { padding: "16px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    title: { fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
    subtitle: { fontSize: 12, color: "#64748b", marginTop: 4 } as React.CSSProperties,
    filterBar: { display: "flex", gap: 6, padding: "12px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    filterBtn: (active: boolean) => ({ padding: "4px 12px", fontSize: 12, borderRadius: 20, border: "1px solid " + (active ? "#3b82f6" : "#334155"), background: active ? "#1e3a5f" : "transparent", color: active ? "#93c5fd" : "#94a3b8", cursor: "pointer" }) as React.CSSProperties,
    list: { flex: 1, overflowY: "auto" as const, padding: "8px 12px" } as React.CSSProperties,
    card: (isHovered: boolean) => ({ padding: "10px 12px", marginBottom: 6, borderRadius: 8, background: isHovered ? "#1a2744" : "#111827", border: `1px solid ${isHovered ? "#3b82f6" : "#1e293b"}`, cursor: "pointer", transition: "all 0.2s", textDecoration: "none" as const, display: "block" as const, color: "inherit" as const }) as React.CSSProperties,
    badge: (sev: string) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: SC[sev] + "22", color: SC[sev] }) as React.CSSProperties,
    center: { flex: 1, display: "flex", flexDirection: "column" as const } as React.CSSProperties,
    topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #1e293b", background: "#0d1220" } as React.CSSProperties,
    mapWrap: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", background: "#070b14", overflow: "hidden" } as React.CSSProperties,
    stats: { width: 280, borderLeft: "1px solid #1e293b", background: "#0f1525", padding: 20, overflowY: "auto" as const } as React.CSSProperties,
    statCard: { background: "#111827", borderRadius: 8, padding: "12px 16px", marginBottom: 12 } as React.CSSProperties,
  };

  return (
    <div style={s.root}>
      {/* 左側欄：新聞事故列表，每則直接連結至該新聞 */}
      <div style={s.sidebar}>
        <div style={s.header}>
          <h1 style={s.title}><span style={{ fontSize: 22 }}>🚨</span> TrafficWatch</h1>
          <div style={s.subtitle}>台灣即時交通事故監控 — {timeStr}</div>
        </div>
        <div style={s.filterBar}>
          {[["all", "全部"], ["critical", "嚴重"], ["major", "中度"], ["minor", "輕微"]].map(([k, label]) => {
            const count = k === "all" ? newsItems.length : k === "critical" ? critC : k === "major" ? majC : minC;
            return (
              <button key={k} style={s.filterBtn(filter === k)} onClick={() => setFilter(k)}>
                {label} ({count})
              </button>
            );
          })}
        </div>
        <div style={s.list}>
          {newsLoading && (
            <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
              搜尋今日交通事故新聞中...
            </div>
          )}
          {!newsLoading && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
              {newsItems.length === 0 ? "今日暫無相關新聞" : "此分類無相關新聞"}
            </div>
          )}
          {filtered.map((news, i) => {
            const sev = getSeverity(news.title);
            const city = extractCity(news.title);
            const type = extractType(news.title);
            return (
              <a
                key={i}
                href={news.link}
                target="_blank"
                rel="noopener noreferrer"
                style={s.card(highlightCity === city)}
                onMouseEnter={() => setHighlightCity(city)}
                onMouseLeave={() => setHighlightCity(null)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={s.badge(sev)}>{SL[sev]}</span>
                    <span style={{ fontSize: 11, color: "#64748b", background: "#1e293b", padding: "1px 8px", borderRadius: 8 }}>{city}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{timeAgo(news.pubDate)}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.5, marginBottom: 4 }}>
                  {news.title}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>{type}</span>
                    <span style={{ fontSize: 11, color: "#3b82f6" }}>{news.source}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "#475569" }}>查看新聞 →</span>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* 中央：台灣地圖 */}
      <div style={s.center}>
        <div style={s.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>🗺️ 台灣交通事故地圖</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {newsItems.length > 0 ? `今日 ${newsItems.length} 則事故新聞` : "載入中..."}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#475569" }}>每 5 分鐘自動更新</div>
        </div>
        <div style={s.mapWrap}>
          {newsLoading ? (
            <div style={{ color: "#475569", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🗺️</div>
              載入地圖中...
            </div>
          ) : (
            <TaiwanMap newsItems={newsItems} highlightCity={highlightCity} />
          )}
        </div>
      </div>

      {/* 右側欄 */}
      <div style={s.stats}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginTop: 0, marginBottom: 16, letterSpacing: 1 }}>即時統計</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            { label: "新聞總數", val: newsItems.length, color: "#f8fafc" },
            { label: "嚴重事故", val: critC, color: "#ef4444" },
            { label: "中度事故", val: majC, color: "#f59e0b" },
            { label: "輕微事故", val: minC, color: "#3b82f6" },
          ].map((c) => (
            <div key={c.label} style={s.statCard}>
              <div style={{ fontSize: 11, color: "#64748b" }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>

        <div style={s.statCard}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>事故熱區</div>
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
            {newsItems.length > 0 && (<>
              <div style={{ width: `${(critC / newsItems.length) * 100}%`, background: "#ef4444" }} />
              <div style={{ width: `${(majC / newsItems.length) * 100}%`, background: "#f59e0b" }} />
              <div style={{ width: `${(minC / newsItems.length) * 100}%`, background: "#3b82f6" }} />
            </>)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
            <span>嚴重 {critC}</span><span>中度 {majC}</span><span>輕微 {minC}</span>
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

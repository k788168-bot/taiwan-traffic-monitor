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
const fetcher = (url: string) => fetch(url).then((r) => r.json());

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
}

// 從標題提取城市
function extractCity(title: string): string {
  const cities = ["台北", "新北", "桃園", "台中", "台南", "高雄", "基隆", "新竹", "苗栗", "彰化", "南投", "雲林", "嘉義", "屏東", "宜蘭", "花蓮", "台東", "澎湖", "金門", "連江"];
  for (const c of cities) {
    if (title.includes(c)) return c;
  }
  return "台灣";
}

// 判斷嚴重程度
function getSeverity(title: string): "critical" | "major" | "minor" {
  if (/死亡|罹難|身亡|不治|喪命/.test(title)) return "critical";
  if (/重傷|酒駕|逆向|國道|高速/.test(title)) return "major";
  return "minor";
}

const SL: Record<string, string> = { critical: "嚴重", major: "中度", minor: "輕微" };
const SC: Record<string, string> = { critical: "#ef4444", major: "#f59e0b", minor: "#3b82f6" };

// ===== 台灣地圖 SVG =====
function TaiwanMap({ newsItems, hoveredIdx }: { newsItems: NewsItem[]; hoveredIdx: number | null }) {
  // 城市在地圖上的大致位置（相對座標 0-100）
  const cityPositions: Record<string, { x: number; y: number }> = {
    "台北": { x: 55, y: 10 }, "新北": { x: 60, y: 14 }, "基隆": { x: 65, y: 8 },
    "桃園": { x: 48, y: 18 }, "新竹": { x: 44, y: 24 }, "苗栗": { x: 42, y: 30 },
    "台中": { x: 38, y: 38 }, "彰化": { x: 34, y: 44 }, "南投": { x: 42, y: 45 },
    "雲林": { x: 32, y: 50 }, "嘉義": { x: 34, y: 56 }, "台南": { x: 32, y: 64 },
    "高雄": { x: 36, y: 72 }, "屏東": { x: 42, y: 80 }, "宜蘭": { x: 66, y: 18 },
    "花蓮": { x: 62, y: 38 }, "台東": { x: 56, y: 62 }, "澎湖": { x: 14, y: 52 },
    "台灣": { x: 45, y: 50 },
  };

  // 統計各城市事故數
  const cityCount: Record<string, number> = {};
  newsItems.forEach((n) => {
    const c = extractCity(n.title);
    cityCount[c] = (cityCount[c] || 0) + 1;
  });

  // 被 hover 的新聞所屬城市
  const hoveredCity = hoveredIdx !== null && newsItems[hoveredIdx] ? extractCity(newsItems[hoveredIdx].title) : null;

  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", maxHeight: "calc(100vh - 60px)" }}>
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </radialGradient>
        <filter id="shadow">
          <feDropShadow dx="0" dy="0" stdDeviation="0.8" floodColor="#3b82f6" floodOpacity="0.3" />
        </filter>
      </defs>

      {/* 背景光暈 */}
      <ellipse cx="48" cy="48" rx="35" ry="48" fill="url(#glow)" />

      {/* 台灣本島輪廓 */}
      <path
        d="M 55 5 Q 58 4, 62 6 Q 65 7, 66 10 Q 67 12, 68 15 Q 69 18, 68 22 Q 67 26, 66 30 Q 65 34, 64 38 Q 63 42, 61 46 Q 59 50, 57 54 Q 55 58, 53 62 Q 51 66, 48 70 Q 45 74, 42 78 Q 40 80, 38 82 Q 36 84, 34 83 Q 32 82, 31 79 Q 30 76, 29 72 Q 28 68, 28 64 Q 28 60, 29 56 Q 30 52, 30 48 Q 30 44, 31 40 Q 32 36, 33 32 Q 34 28, 36 24 Q 38 20, 40 17 Q 42 14, 45 11 Q 48 8, 51 6 Q 53 5, 55 5 Z"
        fill="#1a2744"
        stroke="#3b82f6"
        strokeWidth="0.5"
        filter="url(#shadow)"
        opacity="0.9"
      />

      {/* 城市標記 */}
      {Object.entries(cityPositions).map(([city, pos]) => {
        const count = cityCount[city] || 0;
        const isHovered = hoveredCity === city;
        if (count === 0 && !isHovered) return null;
        const r = Math.min(1.2 + count * 0.6, 3.5);
        return (
          <g key={city}>
            {/* 脈動光圈 */}
            {isHovered && (
              <>
                <circle cx={pos.x} cy={pos.y} r={r + 3} fill="none" stroke="#ef4444" strokeWidth="0.3" opacity="0.6">
                  <animate attributeName="r" from={r + 1} to={r + 5} dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
                </circle>
              </>
            )}
            {count > 0 && !isHovered && (
              <circle cx={pos.x} cy={pos.y} r={r + 2} fill="none" stroke="#f59e0b" strokeWidth="0.2" opacity="0.4">
                <animate attributeName="r" from={r} to={r + 3} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {/* 圓點 */}
            <circle
              cx={pos.x} cy={pos.y} r={r}
              fill={isHovered ? "#ef4444" : count > 2 ? "#ef4444" : count > 0 ? "#f59e0b" : "#3b82f6"}
              opacity={isHovered ? 1 : 0.85}
            />
            {/* 城市名 */}
            <text x={pos.x} y={pos.y - r - 1.2} textAnchor="middle" fill={isHovered ? "#f8fafc" : "#94a3b8"}
              fontSize={isHovered ? 3.5 : 2.8} fontWeight={isHovered ? 700 : 400}>
              {city}
            </text>
            {/* 數量 */}
            {count > 0 && (
              <text x={pos.x} y={pos.y + 0.8} textAnchor="middle" fill="#fff" fontSize={r > 2 ? 2.2 : 1.8} fontWeight="700">
                {count}
              </text>
            )}
          </g>
        );
      })}

      {/* 圖例 */}
      <g transform="translate(2, 88)">
        <text fill="#64748b" fontSize="2.5" fontWeight="600">事故分佈</text>
        <circle cx="2" cy="5" r="1" fill="#f59e0b" />
        <text x="5" y="6" fill="#94a3b8" fontSize="2">1-2 則</text>
        <circle cx="18" cy="5" r="1.3" fill="#ef4444" />
        <text x="21" y="6" fill="#94a3b8" fontSize="2">3+ 則</text>
      </g>
    </svg>
  );
}

// ===== 主元件 =====
export default function TrafficMonitor() {
  const { data: newsData, error: newsError, isLoading: newsLoading } = useSWR<NewsItem[]>("/api/news", fetcher, {
    refreshInterval: 300000,
    revalidateOnFocus: false,
  });

  const [now, setNow] = useState<Date | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const newsItems = Array.isArray(newsData) ? newsData : [];

  // 篩選
  const filtered = filter === "all"
    ? newsItems
    : newsItems.filter((n) => getSeverity(n.title) === filter);

  // 統計
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
    sidebar: { width: 380, display: "flex", flexDirection: "column" as const, borderRight: "1px solid #1e293b", background: "#0f1525" } as React.CSSProperties,
    header: { padding: "16px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    title: { fontSize: 18, fontWeight: 700, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,
    subtitle: { fontSize: 12, color: "#64748b", marginTop: 4 } as React.CSSProperties,
    filterBar: { display: "flex", gap: 6, padding: "12px 20px", borderBottom: "1px solid #1e293b" } as React.CSSProperties,
    filterBtn: (active: boolean) => ({ padding: "4px 12px", fontSize: 12, borderRadius: 20, border: "1px solid " + (active ? "#3b82f6" : "#334155"), background: active ? "#1e3a5f" : "transparent", color: active ? "#93c5fd" : "#94a3b8", cursor: "pointer" }) as React.CSSProperties,
    list: { flex: 1, overflowY: "auto" as const, padding: "8px 12px" } as React.CSSProperties,
    card: (isHovered: boolean) => ({ padding: "12px 14px", marginBottom: 6, borderRadius: 8, background: isHovered ? "#1a2744" : "#111827", border: `1px solid ${isHovered ? "#3b82f6" : "#1e293b"}`, cursor: "pointer", transition: "all 0.2s" }) as React.CSSProperties,
    badge: (sev: string) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, background: SC[sev] + "22", color: SC[sev] }) as React.CSSProperties,
    center: { flex: 1, display: "flex", flexDirection: "column" as const } as React.CSSProperties,
    topBar: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #1e293b", background: "#0d1220" } as React.CSSProperties,
    mapWrap: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", background: "#070b14", overflow: "hidden" } as React.CSSProperties,
    stats: { width: 280, borderLeft: "1px solid #1e293b", background: "#0f1525", padding: 20, overflowY: "auto" as const } as React.CSSProperties,
    statCard: { background: "#111827", borderRadius: 8, padding: "12px 16px", marginBottom: 12 } as React.CSSProperties,
  };

  return (
    <div style={s.root}>
      {/* 左側欄：事故新聞列表 */}
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
            const globalIdx = newsItems.indexOf(news);
            return (
              <a
                key={i}
                href={news.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none", color: "inherit", display: "block" }}
                onMouseEnter={() => setHoveredIdx(globalIdx)}
                onMouseLeave={() => setHoveredIdx(null)}
              >
                <div style={s.card(hoveredIdx === globalIdx)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={s.badge(sev)}>{SL[sev]}</span>
                      <span style={{ fontSize: 12, color: "#64748b", background: "#1e293b", padding: "1px 8px", borderRadius: 8 }}>{city}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "#64748b" }}>{timeAgo(news.pubDate)}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", lineHeight: 1.5, marginBottom: 4 }}>
                    {news.title}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#3b82f6" }}>{news.source || "新聞來源"}</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>點擊查看 →</span>
                  </div>
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
            <TaiwanMap newsItems={newsItems} hoveredIdx={hoveredIdx} />
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

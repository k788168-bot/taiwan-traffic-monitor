"use client";
import dynamic from "next/dynamic";

const TrafficMonitor = dynamic(() => import("@/components/TrafficMonitor"), {
  ssr: false,
  loading: () => (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0e17", color: "#64748b", fontFamily: "system-ui" }}>
      載入中...
    </div>
  ),
});

export default function Home() {
  return <TrafficMonitor />;
}

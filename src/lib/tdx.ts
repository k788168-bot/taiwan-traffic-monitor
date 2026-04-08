// src/lib/tdx.ts

let cachedToken: { token: string; expires: number } | null = null;

export async function getTdxToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires) {
    return cachedToken.token;
  }

  const res = await fetch(
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.TDX_CLIENT_ID!,
        client_secret: process.env.TDX_CLIENT_SECRET!,
      }),
    }
  );

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

export interface TrafficIncident {
  id: string;
  city: string;
  lat: number;
  lng: number;
  road: string;
  type: string;
  severity: "critical" | "major" | "minor";
  time: string;
  description: string;
  direction: string;
}

export async function fetchTrafficIncidents(): Promise<TrafficIncident[]> {
  const token = await getTdxToken();

  const urls = [
    "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/Event/Freeway",
    "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/Live/Event/Highway",
  ];

  const results: TrafficIncident[] = [];

  for (const url of urls) {
    try {
      const res = await fetch(`${url}?$format=JSON`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) continue;
      const data = await res.json();

      const events = data.LiveTrafficEventList || data || [];

      for (const event of events) {
        const isAccident =
          event.EventType === "Accident" ||
          event.EventStatus === "Accident" ||
          (event.Description && event.Description.includes("事故"));

        if (!isAccident && event.EventType !== "Congestion") continue;

        const lat = event.Latitude || event.StartLatitude || 0;
        const lng = event.Longitude || event.StartLongitude || 0;

        if (lat === 0 || lng === 0) continue;

        let severity: "critical" | "major" | "minor" = "minor";
        if (event.Level === 1 || event.Description?.includes("死亡")) {
          severity = "critical";
        } else if (event.Level === 2 || event.Description?.includes("封閉")) {
          severity = "major";
        }

        results.push({
          id: event.EventID || `evt-${Date.now()}-${Math.random()}`,
          city: event.RoadName || event.RouteName || "未知路段",
          lat,
          lng,
          road: event.RoadSection || event.RouteName || "",
          type: event.EventType === "Accident" ? "交通事故" : "壅塞事件",
          severity,
          time: event.StartTime || event.UpdateTime || new Date().toISOString(),
          description: event.Description || "",
          direction: event.Direction || "",
        });
      }
    } catch (err) {
      console.error(`Failed to fetch ${url}:`, err);
    }
  }

  return results;
}

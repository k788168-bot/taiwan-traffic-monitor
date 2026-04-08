// src/app/api/cctv-debug/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const debug: any = { steps: [] };

  try {
    // Step 1: 取得 Token
    const clientId = process.env.TDX_CLIENT_ID;
    const clientSecret = process.env.TDX_CLIENT_SECRET;
    debug.steps.push({ step: "env", hasId: !!clientId, hasSecret: !!clientSecret });

    const tokenRes = await fetch(
      "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId || "",
          client_secret: clientSecret || "",
        }),
      }
    );
    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;
    debug.steps.push({ step: "token", status: tokenRes.status, hasToken: !!token, error: tokenData.error || null });

    if (!token) {
      return NextResponse.json(debug);
    }

    // Step 2: 測試國道 CCTV
    const freewayUrl = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Freeway?%24top=3&%24format=JSON";
    const freewayRes = await fetch(freewayUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const freewayStatus = freewayRes.status;
    let freewayData: any = null;
    let freewayText = "";

    if (freewayRes.ok) {
      freewayData = await freewayRes.json();
    } else {
      freewayText = await freewayRes.text().catch(() => "");
    }

    debug.steps.push({
      step: "freeway",
      url: freewayUrl,
      status: freewayStatus,
      isArray: Array.isArray(freewayData),
      keys: freewayData && typeof freewayData === "object" ? Object.keys(freewayData) : [],
      dataLength: Array.isArray(freewayData) ? freewayData.length : "N/A",
      sample: JSON.stringify(freewayData)?.slice(0, 500),
      errorText: freewayText?.slice(0, 300),
    });

    // Step 3: 測試省道 CCTV
    const highwayUrl = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/Highway?%24top=3&%24format=JSON";
    const highwayRes = await fetch(highwayUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const highwayStatus = highwayRes.status;
    let highwayData: any = null;
    let highwayText = "";

    if (highwayRes.ok) {
      highwayData = await highwayRes.json();
    } else {
      highwayText = await highwayRes.text().catch(() => "");
    }

    debug.steps.push({
      step: "highway",
      url: highwayUrl,
      status: highwayStatus,
      isArray: Array.isArray(highwayData),
      keys: highwayData && typeof highwayData === "object" ? Object.keys(highwayData) : [],
      dataLength: Array.isArray(highwayData) ? highwayData.length : "N/A",
      sample: JSON.stringify(highwayData)?.slice(0, 500),
      errorText: highwayText?.slice(0, 300),
    });

    return NextResponse.json(debug);
  } catch (err: any) {
    debug.error = err.message;
    return NextResponse.json(debug);
  }
}

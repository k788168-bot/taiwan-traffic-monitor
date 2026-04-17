// src/app/api/cctv-image/route.ts
// 圖片代理：解決 CCTV 圖片的 CORS 和 HTTP 混合內容問題
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Missing url", { status: 400 });
  }

  // 只允許 http/https URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return new NextResponse("Invalid URL scheme", { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/jpeg, image/png, image/*, */*",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error(`CCTV image proxy: upstream ${res.status} for ${url}`);
      return new NextResponse(`Upstream ${res.status}`, { status: 502 });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";

    // 確認回傳的是圖片，不是 HTML 錯誤頁面
    if (contentType.includes("text/html")) {
      console.error(`CCTV image proxy: got HTML instead of image for ${url}`);
      return new NextResponse("Not an image", { status: 502 });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=20, s-maxage=20",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error(`CCTV image proxy error: ${err.message} for ${url}`);
    return new NextResponse(`Proxy error`, { status: 502 });
  }
}

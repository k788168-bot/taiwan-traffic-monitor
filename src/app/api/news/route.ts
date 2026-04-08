// src/app/api/news/route.ts
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: string;
  description: string;
}

let cache: { data: NewsItem[]; time: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

export async function GET() {
  try {
    if (cache && Date.now() - cache.time < CACHE_TTL) {
      return NextResponse.json(cache.data);
    }

    const query = encodeURIComponent("台灣 交通事故");
    const rssUrl = `https://news.google.com/rss/search?q=${query}+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`;

    const res = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);

    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = extractTag(itemXml, "title");
      const link = extractTag(itemXml, "link");
      const pubDate = extractTag(itemXml, "pubDate");
      const source = extractTag(itemXml, "source");
      const description = extractTag(itemXml, "description").replace(/<[^>]*>/g, "").trim();

      const isRelevant =
        title.includes("事故") || title.includes("車禍") || title.includes("撞") ||
        title.includes("交通") || title.includes("死亡") || title.includes("傷亡") ||
        title.includes("翻車") || title.includes("追撞") || title.includes("肇事") ||
        title.includes("酒駕") || title.includes("闖紅燈") || title.includes("國道") ||
        description.includes("車禍") || description.includes("事故");

      if (isRelevant && title) {
        items.push({ title, link, source, pubDate, description });
      }
    }

    items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const result = items.slice(0, 30);
    cache = { data: result, time: Date.now() };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (error) {
    console.error("News API Error:", error);
    return NextResponse.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}

function extractTag(xml: string, tag: string): string {
  const m1 = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  if (m1) return m1[1].trim();
  const m2 = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m2 ? m2[1].trim() : "";
}

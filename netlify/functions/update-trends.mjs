// netlify/functions/update-trends.mjs
//
// Netlify Scheduled Function — runs on the 1st of each month.
// Scrapes education sources, sends to Claude for analysis, writes JSON to
// the site's /public directory via Netlify Blobs (persistent key-value store).
//
// Environment variables (set in Netlify dashboard → Site settings → Environment):
//   ANTHROPIC_API_KEY — your Anthropic API key
//
// Schedule is defined in netlify.toml (see project root).

import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

// ─── Sources ────────────────────────────────────────────────────────────────

const SOURCES = [
  { id: "edweek", name: "Education Week", url: "https://www.edweek.org/" },
  { id: "edutopia", name: "Edutopia", url: "https://www.edutopia.org/" },
  { id: "gettingsmart", name: "Getting Smart", url: "https://www.gettingsmart.com/" },
  { id: "k12dive", name: "K-12 Dive", url: "https://www.k12dive.com/" },
  { id: "edsurge", name: "EdSurge", url: "https://www.edsurge.com/news" },
  { id: "iscresearch", name: "ISC Research", url: "https://iscresearch.com/blog/" },
  { id: "nais", name: "NAIS", url: "https://www.nais.org/resource-center/" },
  { id: "whiteboard", name: "Whiteboard Advisors", url: "https://whiteboardadvisors.com/insights/" },
  { id: "asugsv", name: "ASU+GSV", url: "https://asugsvsummit.com/" },
  { id: "nesacenter", name: "NESA Center", url: "https://www.nesacenter.org/" },
  { id: "ecis", name: "ECIS", url: "https://ecis.org/" },
  { id: "amisa", name: "AMISA", url: "https://www.amisa.us/" },
  { id: "ednotebook", name: "Educators Notebook", url: "https://educatorsnotebook.com/" },
  { id: "holoniq", name: "HolonIQ", url: "https://www.holoniq.com/notes" },
  { id: "brookings", name: "Brookings Education", url: "https://www.brookings.edu/topic/education/" },
  { id: "unesco", name: "UNESCO Education", url: "https://www.unesco.org/en/education" },
  { id: "worldbank", name: "World Bank Education", url: "https://blogs.worldbank.org/en/education" },
  { id: "teachai", name: "TeachAI", url: "https://www.teachai.org/" },
];

const FORCES = [
  { id: "ai", name: "AI & emerging technology" },
  { id: "enroll", name: "Enrollment & demographics" },
  { id: "fund", name: "Funding & financial sustainability" },
  { id: "teach", name: "Teacher workforce & wellbeing" },
  { id: "choice", name: "School choice & competition" },
  { id: "gov", name: "Governance & policy shifts" },
  { id: "well", name: "Student wellbeing & engagement" },
  { id: "curric", name: "Curriculum & pedagogy innovation" },
  { id: "privacy", name: "Data privacy & cybersecurity" },
  { id: "climate", name: "Climate & infrastructure" },
  { id: "dei", name: "DEI & cultural identity" },
  { id: "global", name: "Global mobility & internationalization" },
];

const REGIONS = [
  "North America", "Latin America", "Europe", "Sub-Saharan Africa",
  "MENA", "NESA", "Oceania", "East Asia"
];

// ─── Scraping ───────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ForcesAtPlay-TrendBot/1.0 (education research)",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractHeadlines(html, sourceName) {
  if (!html) return [];
  const articles = [];
  // Regex-based extraction (no DOM parser needed in serverless)
  // Grab text from heading tags inside links, or link text near headings
  const patterns = [
    /<h[1-4][^>]*>([^<]{20,200})<\/h[1-4]>/gi,
    /<a[^>]*>\s*<h[1-4][^>]*>([^<]{20,200})<\/h[1-4]>\s*<\/a>/gi,
    /<h[1-4][^>]*>\s*<a[^>]*>([^<]{20,200})<\/a>\s*<\/h[1-4]>/gi,
    /<a[^>]*class="[^"]*(?:title|headline|card)[^"]*"[^>]*>([^<]{20,200})<\/a>/gi,
  ];

  const seen = new Set();
  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(html)) !== null && articles.length < 20) {
      const title = match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const key = title.toLowerCase().substring(0, 50);
      if (title.length > 20 && !seen.has(key) &&
          !title.includes("Subscribe") && !title.includes("Sign Up") &&
          !title.includes("Cookie") && !title.includes("Privacy Policy")) {
        seen.add(key);
        articles.push({ title, source: sourceName });
      }
    }
  }

  // Fallback: extract <title> tag and meta description
  if (articles.length === 0) {
    const titleMatch = html.match(/<title>([^<]{10,200})<\/title>/i);
    if (titleMatch) {
      articles.push({ title: titleMatch[1].trim(), source: sourceName });
    }
  }

  return articles;
}

// ─── Claude Analysis ────────────────────────────────────────────────────────

async function analyzeWithClaude(allArticles) {
  const client = new Anthropic();
  const now = new Date();
  const monthYear = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const articleText = allArticles.map((a, i) =>
    `[${i}] ${a.source}: ${a.title}`
  ).join("\n");

  const systemPrompt = `You are a world-class education futurist. Analyze the following scraped K-12 education headlines and produce a structured JSON array of 40-70 trend signals for a "Forces at Play" interactive map.

FORCES (use these exact IDs):
${FORCES.map(f => `- "${f.id}": ${f.name}`).join("\n")}

REGIONS: ${REGIONS.map(r => `"${r}"`).join(", ")}

SCHOOL TYPES:
- "Private" — available for ALL regions
- "Public" — ONLY valid for North America

RULES:
1. Produce 40-70 signals. Each must be a current, real trend.
2. Every signal: force ID, headline (<120 chars), regions array, types array, source name, 1-2 sentence description.
3. Distribute across all 12 forces (min 2, max 10 each) and all 8 regions.
4. "Public" type is ONLY valid when "North America" is in the regions array.
5. Skip vague, generic, or non-education headlines.
6. Synthesize related headlines into single stronger signals.
7. Fill gaps in underrepresented regions/forces from your current knowledge — mark source as "Analysis".

Respond with ONLY valid JSON. No markdown fences, no preamble.
Format: [{"f":"id","t":"Headline","r":["Region"],"s":["Type"],"src":"Source","d":"Description."}]`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Analyze these ${allArticles.length} headlines from ${monthYear}:\n\n${articleText}`
    }],
  });

  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validate(signals) {
  const validForces = new Set(FORCES.map(f => f.id));
  const validRegions = new Set(REGIONS);

  return signals.filter(s => {
    if (!validForces.has(s.f) || !s.t || !s.d) return false;
    if (!Array.isArray(s.r) || !Array.isArray(s.s)) return false;
    s.r = s.r.filter(r => validRegions.has(r));
    if (s.s.includes("Public") && !s.r.includes("North America")) {
      s.s = s.s.filter(x => x !== "Public");
      if (s.s.length === 0) s.s = ["Private"];
    }
    s.s = s.s.filter(x => x === "Private" || x === "Public");
    return s.r.length > 0 && s.s.length > 0;
  });
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req) {
  console.log("Forces at Play: Monthly update starting...");

  // Step 1: Scrape
  let allArticles = [];
  for (const source of SOURCES) {
    console.log(`  Scraping ${source.name}...`);
    const html = await fetchPage(source.url);
    const articles = extractHeadlines(html, source.name);
    allArticles.push(...articles);
    console.log(`    → ${articles.length} headlines`);
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  Total scraped: ${allArticles.length}`);

  // Step 2: Analyze
  console.log("  Sending to Claude...");
  let signals;
  try {
    signals = await analyzeWithClaude(allArticles);
    console.log(`  Claude returned ${signals.length} signals`);
  } catch (err) {
    console.error("  Claude API failed:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }

  // Step 3: Validate
  const validated = validate(signals);
  console.log(`  Validated: ${validated.length}`);

  // Step 4: Build output
  const now = new Date();
  const output = {
    meta: {
      generated: now.toISOString(),
      month: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
      signalCount: validated.length,
      sourceCount: SOURCES.length,
      forces: FORCES,
      regions: REGIONS,
      version: "1.0",
    },
    signals: validated,
  };

  // Step 5: Store in Netlify Blobs
  const store = getStore("forces-at-play");
  await store.set("trends-data", JSON.stringify(output), { metadata: { updated: now.toISOString() } });
  console.log("  Written to Netlify Blobs.");

  return new Response(JSON.stringify({ success: true, signals: validated.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Tell Netlify this is a scheduled function
export const config = {
  schedule: "@monthly", // Runs on the 1st of every month
};

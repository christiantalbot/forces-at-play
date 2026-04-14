import { getStore } from "@netlify/blobs";

const SOURCES = [
  { name: "Education Week", url: "https://www.edweek.org/" },
  { name: "Edutopia", url: "https://www.edutopia.org/" },
  { name: "Getting Smart", url: "https://www.gettingsmart.com/" },
  { name: "K-12 Dive", url: "https://www.k12dive.com/" },
  { name: "EdSurge", url: "https://www.edsurge.com/news" },
  { name: "ISC Research", url: "https://iscresearch.com/blog/" },
  { name: "NAIS", url: "https://www.nais.org/resource-center/" },
  { name: "Whiteboard Advisors", url: "https://whiteboardadvisors.com/insights/" },
  { name: "ASU+GSV", url: "https://asugsvsummit.com/" },
  { name: "NESA Center", url: "https://www.nesacenter.org/" },
  { name: "ECIS", url: "https://ecis.org/" },
  { name: "AMISA", url: "https://www.amisa.us/" },
  { name: "Educators Notebook", url: "https://educatorsnotebook.com/" },
  { name: "HolonIQ", url: "https://www.holoniq.com/notes" },
  { name: "Brookings Education", url: "https://www.brookings.edu/topic/education/" },
  { name: "UNESCO Education", url: "https://www.unesco.org/en/education" },
  { name: "World Bank Education", url: "https://blogs.worldbank.org/en/education" },
  { name: "TeachAI", url: "https://www.teachai.org/" },
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

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ForcesAtPlay/1.0", "Accept": "text/html,*/*" },
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
          !title.includes("Cookie") && !title.includes("Privacy")) {
        seen.add(key);
        articles.push({ title, source: sourceName });
      }
    }
  }
  return articles;
}

async function callClaude(articles) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const now = new Date();
  const monthYear = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  const articleText = articles.map((a, i) => `[${i}] ${a.source}: ${a.title}`).join("\n");

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

  console.log("  Calling Claude API via fetch...");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Analyze these ${articles.length} headlines from ${monthYear}:\n\n${articleText}`
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.content.filter(b => b.type === "text").map(b => b.text).join("");
  return JSON.parse(text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim());
}

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

export default async function handler(req) {
  console.log("Forces at Play: Monthly update starting...");

  try {
    let allArticles = [];
    for (const source of SOURCES) {
      console.log(`  Scraping ${source.name}...`);
      const html = await fetchPage(source.url);
      const articles = extractHeadlines(html, source.name);
      allArticles.push(...articles);
      console.log(`    > ${articles.length} headlines`);
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`  Total scraped: ${allArticles.length}`);

    console.log("  Sending to Claude...");
    const signals = await callClaude(allArticles);
    console.log(`  Claude returned ${signals.length} signals`);

    const validated = validate(signals);
    console.log(`  Validated: ${validated.length}`);

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

    const store = getStore("forces-at-play");
    await store.set("trends-data", JSON.stringify(output));
    console.log("  Written to Netlify Blobs. Done!");

    return new Response(JSON.stringify({ success: true, signals: validated.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("  ERROR:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export const config = {
  schedule: "@monthly",
  type: "background",
};

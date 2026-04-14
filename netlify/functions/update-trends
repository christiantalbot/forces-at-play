// netlify/functions/trends-data.mjs
//
// API endpoint that serves the latest trend data from Netlify Blobs.
// The frontend widget fetches this URL.
//
// URL: https://your-site.netlify.app/.netlify/functions/trends-data

import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  // CORS headers — allow your Squarespace domain and localhost for testing
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const store = getStore("forces-at-play");
    const data = await store.get("trends-data");

    if (!data) {
      return new Response(
        JSON.stringify({ error: "No data available yet. Run the update function first." }),
        { status: 404, headers: corsHeaders }
      );
    }

    return new Response(data, { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to retrieve data", detail: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

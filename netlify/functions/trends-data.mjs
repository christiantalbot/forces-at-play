import { getStore } from "@netlify/blobs";

export default async function handler(req) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=3600",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const store = getStore({ name: "forces-at-play", consistency: "strong" });
    const data = await store.get("trends-data", { type: "text" });

    console.log("Blob lookup result type:", typeof data);
    console.log("Blob lookup result is null:", data === null);
    console.log("Blob lookup result length:", data ? data.length : 0);

    if (!data) {
      return new Response(
        JSON.stringify({ error: "No data available yet. Run the update function first." }),
        { status: 404, headers: corsHeaders }
      );
    }

    return new Response(data, { status: 200, headers: corsHeaders });
  } catch (err) {
    console.error("Blob read error:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: "Failed to retrieve data", detail: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

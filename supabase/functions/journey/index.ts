const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const allowedOrigins = new Set(["https://cloudyhelps.vercel.app", "http://127.0.0.1:8000", "http://127.0.0.1:3000", "http://localhost:8000", "http://localhost:3000"]);

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-city, x-client-country, x-client-latitude, x-client-longitude, x-client-ip",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  };
};
const json = (request: Request, payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const fromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
const requireAdmin = async (request: Request) => {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/is_campaign_admin`, { method: "POST", headers: { apikey: publishableKey, Authorization: authorization, "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok || !(await response.json().catch(() => false))) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(authorization.slice(7).split(".")[1])));
    return /^[0-9a-f-]{36}$/i.test(payload.sub || "");
  } catch { return false; }
};
const cleanHeader = (request: Request, name: string, maximum = 180) => {
  const raw = request.headers.get(name) || "";
  try { return decodeURIComponent(raw).replace(/[\u0000-\u001f]/g, "").slice(0, maximum); } catch { return raw.slice(0, maximum); }
};
const coordinate = (value: string, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};
const maskIp = (value: string) => {
  const first = String(value || "").split(",")[0].trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(first)) return `${first.split(".").slice(0, 3).join(".")}.*`;
  if (first.includes(":")) return `${first.split(":").slice(0, 3).join(":")}:*`;
  return "";
};
const sourceFrom = (body: Record<string, any>) => {
  if (body.ttclid) return "TikTok Ads";
  if (body.gclid) return "Google Ads";
  if (body.fbclid || body.fbc) return "Meta Ads";
  const source = String(body.utmSource || "").trim().slice(0, 80);
  return source ? `UTM: ${source}` : "Direto / não identificado";
};

const handleView = async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const sessionId = String(body.sessionId || "");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json(request, { error: "Sessão inválida." }, 422);
  const event = {
    dedupe_key: `offer:${sessionId}`,
    session_id: sessionId,
    stage: "offer",
    city: cleanHeader(request, "x-client-city"),
    country_code: cleanHeader(request, "x-client-country", 3).toUpperCase(),
    latitude: coordinate(cleanHeader(request, "x-client-latitude", 30), -90, 90),
    longitude: coordinate(cleanHeader(request, "x-client-longitude", 30), -180, 180),
    ip_masked: maskIp(cleanHeader(request, "x-client-ip", 100)),
    source: sourceFrom(body),
    device: String(body.userAgent || "").slice(0, 500),
    page_url: String(body.pageUrl || "").slice(0, 1000),
    occurred_at: new Date().toISOString()
  };
  const response = await fetch(`${supabaseUrl}/rest/v1/lead_journey_events?on_conflict=dedupe_key`, { method: "POST", headers: { ...serviceHeaders, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(event) });
  if (!response.ok) return json(request, { error: "Não foi possível registrar a jornada." }, 503);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
};
const handleOverview = async (request: Request) => {
  if (!(await requireAdmin(request))) return json(request, { error: "Sessão administrativa inválida ou expirada." }, 401);
  const response = await fetch(`${supabaseUrl}/rest/v1/lead_journey_events?select=id,session_id,stage,external_id,donor_name,donor_email,amount,currency,city,country_code,latitude,longitude,ip_masked,source,device,page_url,occurred_at&order=occurred_at.desc&limit=200`, { headers: serviceHeaders });
  if (!response.ok) return json(request, { error: "Não foi possível carregar a jornada de doadores." }, 503);
  return json(request, { events: await response.json(), refreshedAt: new Date().toISOString() });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const route = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "overview";
  try {
    if (route === "view" && request.method === "POST") return await handleView(request);
    if (route === "overview" && request.method === "GET") return await handleOverview(request);
    return json(request, { error: "Rota não encontrada." }, 404);
  } catch {
    return json(request, { error: "Não foi possível processar a solicitação." }, 503);
  }
});

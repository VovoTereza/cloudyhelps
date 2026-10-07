const EDGE_URL = "https://ojwshgpvijmbcjyiggxl.supabase.co/functions/v1/journey";

const geoHeaders = (request) => ({
  "X-Client-City": String(request.headers["x-vercel-ip-city"] || ""),
  "X-Client-Country": String(request.headers["x-vercel-ip-country"] || ""),
  "X-Client-Latitude": String(request.headers["x-vercel-ip-latitude"] || ""),
  "X-Client-Longitude": String(request.headers["x-vercel-ip-longitude"] || ""),
  "X-Client-IP": String(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "")
});

export const proxyJourney = async (request, response, route) => {
  const headers = { Accept: "application/json", ...geoHeaders(request) };
  if (request.headers.authorization) headers.Authorization = String(request.headers.authorization);
  let body;
  if (request.method === "POST") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.body || {});
  }
  try {
    const upstream = await fetch(`${EDGE_URL}/${route}`, { method: request.method, headers, body });
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return response.status(upstream.status).send(payload);
  } catch {
    return response.status(502).json({ error: "O acompanhamento da jornada está temporariamente indisponível." });
  }
};

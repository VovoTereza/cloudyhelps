const EDGE_URL = "https://ojwshgpvijmbcjyiggxl.supabase.co/functions/v1/navenaut";

const rawBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

export const proxyNavenaut = async (request, response, route, options = {}) => {
  const headers = { Accept: "application/json" };
  if (request.headers.authorization) headers.Authorization = String(request.headers.authorization);
  if (request.headers["x-webhook-signature"]) headers["X-Webhook-Signature"] = String(request.headers["x-webhook-signature"]);
  if (request.headers["x-webhook-event"]) headers["X-Webhook-Event"] = String(request.headers["x-webhook-event"]);
  if (route === "create-intent") {
    headers["X-Client-City"] = String(request.headers["x-vercel-ip-city"] || "");
    headers["X-Client-Country"] = String(request.headers["x-vercel-ip-country"] || "");
    headers["X-Client-Latitude"] = String(request.headers["x-vercel-ip-latitude"] || "");
    headers["X-Client-Longitude"] = String(request.headers["x-vercel-ip-longitude"] || "");
    headers["X-Client-IP"] = String(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "");
  }

  let body;
  if (!["GET", "HEAD"].includes(request.method)) {
    headers["Content-Type"] = "application/json";
    body = options.raw ? await rawBody(request) : JSON.stringify(request.body || {});
  }

  try {
    const upstream = await fetch(`${EDGE_URL}/${route}`, { method: request.method, headers, body });
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return response.status(upstream.status).send(payload);
  } catch {
    return response.status(502).json({ error: "O serviço de pagamentos está temporariamente indisponível." });
  }
};

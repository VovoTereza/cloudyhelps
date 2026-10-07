const EDGE_URL = "https://ojwshgpvijmbcjyiggxl.supabase.co/functions/v1/resend";

export const proxyResend = async (request, response, route) => {
  const headers = { Accept: "application/json" };
  if (request.headers.authorization) headers.Authorization = String(request.headers.authorization);
  let body;
  if (request.method === "POST") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(request.body || {});
  }
  const query = route === "unsubscribe" && request.query?.token ? `?token=${encodeURIComponent(String(request.query.token))}` : "";
  try {
    const upstream = await fetch(`${EDGE_URL}/${route}${query}`, { method: request.method, headers, body });
    const payload = Buffer.from(await upstream.arrayBuffer());
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    return response.status(upstream.status).send(payload);
  } catch {
    return response.status(502).json({ error: "O serviço de e-mail está temporariamente indisponível." });
  }
};

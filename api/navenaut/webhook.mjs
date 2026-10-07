import { proxyNavenaut } from "../_lib/navenaut-proxy.mjs";

export const config = { api: { bodyParser: false } };

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido." });
  }
  return proxyNavenaut(request, response, "webhook", { raw: true });
}

import { proxyNavenaut } from "../_lib/navenaut-proxy.mjs";

export default function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Método não permitido." });
  }
  return proxyNavenaut(request, response, "config");
}

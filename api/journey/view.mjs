import { proxyJourney } from "../_lib/journey-proxy.mjs";

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido." });
  }
  return proxyJourney(request, response, "view");
}

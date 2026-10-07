import { proxyJourney } from "../_lib/journey-proxy.mjs";

export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido." });
  }
  return proxyJourney(request, response, "overview");
}

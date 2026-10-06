import { gatewaySummary, loadGatewayConfig } from "../_lib/gateway-config.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido." });
  }

  response.setHeader("Cache-Control", "no-store");
  try {
    const summary = gatewaySummary(await loadGatewayConfig());
    return response.status(200).json({ provider: "Navenaut", ...summary, publicKey: undefined, productId: undefined });
  } catch {
    return response.status(200).json({ provider: "Navenaut", configured: false, webhookConfigured: false, environment: "unconfigured" });
  }
}

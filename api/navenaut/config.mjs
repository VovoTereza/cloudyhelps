import { gatewaySummary, loadGatewayConfig, requireAdmin, saveGatewayConfig } from "../_lib/gateway-config.mjs";

const readBody = (request) => {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
};

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Método não permitido." });
  }

  let admin;
  try { admin = await requireAdmin(request); }
  catch { return response.status(503).json({ error: "Não foi possível validar a sessão administrativa." }); }
  if (!admin) return response.status(401).json({ error: "Sessão administrativa inválida ou expirada." });

  try {
    const current = await loadGatewayConfig();
    if (request.method === "GET") return response.status(200).json(gatewaySummary(current));

    const body = readBody(request);
    const next = {
      publicKey: String(body.publicKey || current?.publicKey || "").trim(),
      secretKey: String(body.secretKey || current?.secretKey || "").trim(),
      webhookSecret: String(body.webhookSecret || current?.webhookSecret || "").trim(),
      productId: String(body.productId ?? current?.productId ?? "").trim()
    };
    if (!/^pk_(live|test)_[A-Za-z0-9_-]+$/.test(next.publicKey)) {
      return response.status(422).json({ error: "Informe uma chave pública Navenaut válida (pk_live_ ou pk_test_)." });
    }
    if (!/^sk_(live|test)_[A-Za-z0-9_-]+$/.test(next.secretKey)) {
      return response.status(422).json({ error: "Informe uma chave secreta Navenaut válida (sk_live_ ou sk_test_)." });
    }
    const publicEnvironment = next.publicKey.startsWith("pk_live_") ? "live" : "test";
    if (!next.secretKey.startsWith(`sk_${publicEnvironment}_`)) {
      return response.status(422).json({ error: "As chaves pública e secreta precisam pertencer ao mesmo ambiente." });
    }
    if (next.webhookSecret.length < 12) {
      return response.status(422).json({ error: "Informe o segredo de assinatura do webhook." });
    }
    await saveGatewayConfig(next, admin.id);
    return response.status(200).json(gatewaySummary(next));
  } catch (error) {
    return response.status(503).json({ error: error?.message || "Não foi possível acessar a configuração do gateway." });
  }
}

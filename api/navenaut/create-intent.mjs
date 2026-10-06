import crypto from "node:crypto";

const API_URL = "https://navenaut.com/api/public/v1/payments/create-intent";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido." });
  }

  const publicKey = process.env.NAUT_PUBLIC_KEY || "";
  const secretKey = process.env.NAUT_SECRET_KEY || "";
  if (!publicKey || !secretKey) {
    return response.status(503).json({ error: "O gateway Navenaut ainda não possui credenciais de produção." });
  }

  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {}; }
  catch { return response.status(400).json({ error: "JSON inválido." }); }
  const amount = Number(body.amount);
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const requestId = /^[0-9a-f-]{36}$/i.test(String(body.requestId || "")) ? body.requestId : crypto.randomUUID();

  if (!Number.isInteger(amount) || amount < 100 || amount > 10000000) {
    return response.status(422).json({ error: "Informe um valor de doação válido." });
  }
  if (!emailPattern.test(email) || name.length < 2 || name.length > 120) {
    return response.status(422).json({ error: "Informe nome e e-mail válidos." });
  }

  const payload = {
    amount,
    currency: "USD",
    customerData: { email, name },
    requestId
  };
  if (process.env.NAUT_PRODUCT_ID) payload.productId = process.env.NAUT_PRODUCT_ID;

  try {
    const gatewayResponse = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Public-Key": publicKey,
        "X-Secret-Key": secretKey,
        "X-Request-Id": requestId,
        "Idempotency-Key": requestId
      },
      body: JSON.stringify(payload)
    });
    const gatewayPayload = await gatewayResponse.json().catch(() => ({}));
    if (!gatewayResponse.ok || gatewayPayload.success === false) {
      const message = gatewayPayload.error?.message || "Não foi possível iniciar o pagamento.";
      return response.status(gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? 422 : 502).json({ error: message });
    }

    const payment = gatewayPayload.data || gatewayPayload;
    if (!payment.clientSecret || !payment.publishableKey) {
      return response.status(502).json({ error: "A Navenaut não retornou os dados necessários para o pagamento." });
    }
    response.setHeader("Cache-Control", "no-store");
    return response.status(200).json({
      clientSecret: payment.clientSecret,
      publishableKey: payment.publishableKey,
      paymentIntentId: payment.paymentIntentId || null
    });
  } catch {
    return response.status(502).json({ error: "Não foi possível conectar à Navenaut. Tente novamente." });
  }
}

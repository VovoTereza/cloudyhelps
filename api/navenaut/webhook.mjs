import crypto from "node:crypto";
import { loadGatewayConfig } from "../_lib/gateway-config.mjs";

export const config = { api: { bodyParser: false } };

const readRawBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const validSignature = (rawBody, signature, secret) => {
  if (!signature || !secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Método não permitido." });
  }

  const rawBody = await readRawBody(request);
  const signature = String(request.headers["x-webhook-signature"] || "");
  let gatewayConfig;
  try { gatewayConfig = await loadGatewayConfig(); } catch { gatewayConfig = null; }
  if (!validSignature(rawBody, signature, gatewayConfig?.webhookSecret || "")) {
    return response.status(401).json({ error: "Assinatura de webhook inválida." });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return response.status(400).json({ error: "JSON inválido." }); }
  const event = String(payload.event || request.headers["x-webhook-event"] || "");
  const transaction = payload.data || {};
  const externalId = String(transaction.publicId || transaction.transactionId || "");
  if (!event.startsWith("transaction.") || !externalId) return response.status(204).end();

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) return response.status(503).json({ error: "Persistência do webhook não configurada." });

  const record = {
    external_id: externalId,
    event,
    status: transaction.status || null,
    gross_amount: Number.isFinite(Number(transaction.grossAmount)) ? Number(transaction.grossAmount) : null,
    currency: transaction.currency || null,
    payment_method: transaction.paymentMethod || null,
    customer_name: transaction.customer?.name || null,
    customer_email: transaction.customer?.email || null,
    payload,
    occurred_at: payload.timestamp || new Date().toISOString()
  };

  const databaseResponse = await fetch(`${supabaseUrl}/rest/v1/payment_transactions?on_conflict=external_id,event`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(record)
  });
  if (!databaseResponse.ok) return response.status(500).json({ error: "Não foi possível registrar o evento." });
  return response.status(204).end();
}

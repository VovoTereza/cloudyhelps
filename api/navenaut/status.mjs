export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido." });
  }

  const publicKey = process.env.NAUT_PUBLIC_KEY || "";
  const secretKey = process.env.NAUT_SECRET_KEY || "";
  const webhookSecret = process.env.NAUT_WEBHOOK_SECRET || "";

  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({
    provider: "Navenaut",
    configured: Boolean(publicKey && secretKey),
    webhookConfigured: Boolean(webhookSecret),
    environment: publicKey.startsWith("pk_live_") ? "live" : publicKey.startsWith("pk_test_") ? "test" : "unconfigured"
  });
}

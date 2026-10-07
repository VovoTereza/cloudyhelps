const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const encryptionSecret = Deno.env.get("GATEWAY_CONFIG_ENCRYPTION_KEY") || serviceKey;
const provider = "navenaut";
const navenautApi = "https://navenaut.com/api/public/v1/payments/create-intent";
const productsApi = "https://navenaut.com/api/public/v1/products?status=published&limit=100";
const webhookCreateApi = "https://navenaut.com/api/public/v1/webhooks/create";
const webhookUrl = "https://cloudyhelps.vercel.app/api/navenaut/webhook?source=cloudy-impact";
const webhookEvents = ["transaction.created", "transaction.paid", "transaction.failed", "transaction.refunded", "transaction.partially_refunded", "transaction.disputed"];

const allowedOrigins = new Set([
  "https://cloudyhelps.vercel.app",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:3000",
  "http://localhost:8000",
  "http://localhost:3000"
]);

const corsHeaders = (request: Request) => {
  const origin = request.headers.get("origin") || "";
  return {
    ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-webhook-signature, x-webhook-event",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  };
};

const json = (request: Request, payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
const encryptionKey = async () => crypto.subtle.importKey(
  "raw",
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret)),
  "AES-GCM",
  false,
  ["encrypt", "decrypt"]
);
const encrypt = async (value: unknown) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(JSON.stringify(value))
  ));
  return `v1.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
};
const decrypt = async (value: string) => {
  const [version, encodedIv, encodedCiphertext] = String(value || "").split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new Error("Credenciais criptografadas inválidas.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(encodedIv) },
    await encryptionKey(),
    fromBase64Url(encodedCiphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
};

const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const loadConfig = async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/gateway_credentials?provider=eq.${provider}&select=encrypted_config&limit=1`, { headers: serviceHeaders });
  if (!response.ok) throw new Error("Não foi possível carregar as credenciais do gateway.");
  const rows = await response.json();
  return rows[0]?.encrypted_config ? await decrypt(rows[0].encrypted_config) : null;
};
const summary = (config: Record<string, any> | null) => ({
  configured: Boolean(config?.publicKey && config?.secretKey && config?.webhookSecret),
  webhookConfigured: Boolean(config?.webhookSecret),
  environment: config?.publicKey?.startsWith("pk_live_") ? "live" : config?.publicKey?.startsWith("pk_test_") ? "test" : "unconfigured",
  publicKey: config?.publicKey || "",
  secretKeyConfigured: Boolean(config?.secretKey),
  webhookSecretConfigured: Boolean(config?.webhookSecret),
  productSync: config?.productSync || { linked: 0, total: 0, missing: [] }
});

const nautHeaders = (config: Record<string, any>) => ({
  "X-Public-Key": config.publicKey,
  "X-Secret-Key": config.secretKey,
  "Content-Type": "application/json"
});
const normalizeName = (value: unknown) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const loadCampaignTiers = async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/campaign_content?id=eq.main&select=data&limit=1`, { headers: serviceHeaders });
  if (!response.ok) throw new Error("Não foi possível ler os níveis de doação.");
  const rows = await response.json();
  return Array.isArray(rows[0]?.data?.tiers) ? rows[0].data.tiers : [];
};
const usdPrices = (product: Record<string, any>) => {
  const prices = [product.price];
  for (const offer of product.offers || []) {
    prices.push(offer.price, offer.prices?.USD, offer.prices?.usd);
  }
  return prices.map(Number).filter(Number.isFinite);
};
const syncProducts = async (config: Record<string, any>) => {
  const [tiers, response] = await Promise.all([
    loadCampaignTiers(),
    fetch(productsApi, { headers: nautHeaders(config) })
  ]);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    return {
      mappings: [],
      productSync: { linked: 0, total: tiers.length, missing: tiers.map((tier: Record<string, any>) => `${tier.title} ($${tier.amount})`) }
    };
  }
  const products = payload.data?.items || payload.items || [];
  const mappings = tiers.map((tier: Record<string, any>) => {
    const amount = Math.round(Number(tier.amount) * 100);
    const byPrice = products.filter((product: Record<string, any>) => usdPrices(product).includes(amount));
    const exactName = byPrice.find((product: Record<string, any>) => normalizeName(product.name) === normalizeName(tier.title));
    const match = exactName || byPrice[0];
    return match ? { amount, title: String(tier.title || "Donation"), productId: match.id, productName: match.name } : null;
  });
  const missing = tiers.filter((_: unknown, index: number) => !mappings[index]).map((tier: Record<string, any>) => `${tier.title} ($${tier.amount})`);
  return {
    mappings: mappings.filter(Boolean),
    productSync: { linked: mappings.filter(Boolean).length, total: tiers.length, missing }
  };
};
const ensureWebhook = async (config: Record<string, any>, current: Record<string, any> | null) => {
  if (current?.webhookSecret && current?.webhookId) return { webhookSecret: current.webhookSecret, webhookId: current.webhookId };
  const response = await fetch(webhookCreateApi, {
    method: "POST",
    headers: nautHeaders(config),
    body: JSON.stringify({ name: "Cloudy Impact", url: webhookUrl, events: webhookEvents })
  });
  const payload = await response.json().catch(() => ({}));
  const webhook = payload.data || payload;
  if (!response.ok || payload.success === false || !webhook.signingSecret) throw new Error(payload.error?.message || "Não foi possível configurar o webhook automaticamente. Verifique o escopo webhooks:write da chave.");
  return { webhookSecret: webhook.signingSecret, webhookId: webhook.id || "cloudy-impact" };
};

const requireAdmin = async (request: Request) => {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/is_campaign_admin`, {
    method: "POST",
    headers: { apikey: publishableKey, Authorization: authorization, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok || !(await response.json().catch(() => false))) return null;
  try {
    const token = authorization.slice(7).split(".")[1];
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(token)));
    return /^[0-9a-f-]{36}$/i.test(payload.sub || "") ? payload.sub : null;
  } catch { return null; }
};

const handleConfig = async (request: Request) => {
  const userId = await requireAdmin(request);
  if (!userId) return json(request, { error: "Sessão administrativa inválida ou expirada." }, 401);
  const current = await loadConfig();
  if (request.method === "GET") return json(request, summary(current));

  const body = await request.json().catch(() => ({}));
  const credentials = {
    publicKey: String(body.publicKey || current?.publicKey || "").trim(),
    secretKey: String(body.secretKey || current?.secretKey || "").trim()
  };
  if (!/^pk_(live|test)_[A-Za-z0-9_-]+$/.test(credentials.publicKey)) return json(request, { error: "Informe uma chave pública Navenaut válida (pk_live_ ou pk_test_)." }, 422);
  if (!/^sk_(live|test)_[A-Za-z0-9_-]+$/.test(credentials.secretKey)) return json(request, { error: "Informe uma chave privada Navenaut válida (sk_live_ ou sk_test_)." }, 422);
  const environment = credentials.publicKey.startsWith("pk_live_") ? "live" : "test";
  if (!credentials.secretKey.startsWith(`sk_${environment}_`)) return json(request, { error: "As chaves pública e privada precisam pertencer ao mesmo ambiente." }, 422);

  let next;
  try {
    const [{ mappings, productSync }, webhook] = await Promise.all([
      syncProducts(credentials),
      ensureWebhook(credentials, current)
    ]);
    next = { ...credentials, ...webhook, productMappings: mappings, productSync };
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Não foi possível sincronizar a Navenaut." }, 422);
  }

  const databaseResponse = await fetch(`${supabaseUrl}/rest/v1/gateway_credentials?on_conflict=provider`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      provider,
      encrypted_config: await encrypt(next),
      environment,
      configured_fields: { publicKey: true, secretKey: true, webhookSecret: true, products: next.productSync.linked },
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
  });
  if (!databaseResponse.ok) return json(request, { error: "Não foi possível salvar as credenciais do gateway." }, 503);
  return json(request, summary(next));
};

const handleCreateIntent = async (request: Request) => {
  const config = await loadConfig();
  if (!config?.publicKey || !config?.secretKey) return json(request, { error: "O gateway Navenaut ainda não possui credenciais de produção." }, 503);
  const body = await request.json().catch(() => ({}));
  const amount = Number(body.amount);
  const baseAmount = Number(body.baseAmount);
  const productName = String(body.productName || "").trim();
  const medicineSupport = body.medicineSupport === true;
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const requestId = /^[0-9a-f-]{36}$/i.test(String(body.requestId || "")) ? body.requestId : crypto.randomUUID();
  if (!Number.isInteger(amount) || amount < 100 || amount > 10000000) return json(request, { error: "Informe um valor de doação válido." }, 422);
  if (!Number.isInteger(baseAmount) || amount !== baseAmount + (medicineSupport ? 1500 : 0)) return json(request, { error: "A opção de doação selecionada é inválida." }, 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || name.length < 2 || name.length > 120) return json(request, { error: "Informe nome e e-mail válidos." }, 422);

  const candidates = (config.productMappings || []).filter((mapping: Record<string, any>) => Number(mapping.amount) === baseAmount);
  const product = candidates.find((mapping: Record<string, any>) => normalizeName(mapping.title) === normalizeName(productName)) || candidates[0];
  const payload: Record<string, unknown> = { amount, currency: "USD", customerData: { email, name }, requestId };
  if (product?.productId) payload.productId = product.productId;
  const gatewayResponse = await fetch(navenautApi, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": config.publicKey, "X-Secret-Key": config.secretKey, "X-Request-Id": requestId, "Idempotency-Key": requestId },
    body: JSON.stringify(payload)
  });
  const gatewayPayload = await gatewayResponse.json().catch(() => ({}));
  if (!gatewayResponse.ok || gatewayPayload.success === false) return json(request, { error: gatewayPayload.error?.message || "Não foi possível iniciar o pagamento." }, gatewayResponse.status >= 400 && gatewayResponse.status < 500 ? 422 : 502);
  const payment = gatewayPayload.data || gatewayPayload;
  if (!payment.clientSecret || !payment.publishableKey) return json(request, { error: "A Navenaut não retornou os dados necessários para o pagamento." }, 502);
  return json(request, { clientSecret: payment.clientSecret, publishableKey: payment.publishableKey, paymentIntentId: payment.paymentIntentId || null });
};

const signatureIsValid = async (rawBody: string, signature: string, secret: string) => {
  if (!/^[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const received = Uint8Array.from(signature.match(/.{2}/g) || [], (value) => Number.parseInt(value, 16));
  if (expected.length !== received.length) return false;
  return expected.every((value, index) => value === received[index]);
};

const handleWebhook = async (request: Request) => {
  const rawBody = await request.text();
  const config = await loadConfig();
  if (!(await signatureIsValid(rawBody, request.headers.get("x-webhook-signature") || "", config?.webhookSecret || ""))) return json(request, { error: "Assinatura de webhook inválida." }, 401);
  const payload = JSON.parse(rawBody);
  const event = String(payload.event || request.headers.get("x-webhook-event") || "");
  const transaction = payload.data || {};
  const externalId = String(transaction.publicId || transaction.transactionId || "");
  if (!event.startsWith("transaction.") || !externalId) return new Response(null, { status: 204, headers: corsHeaders(request) });
  const databaseResponse = await fetch(`${supabaseUrl}/rest/v1/payment_transactions?on_conflict=external_id,event`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ external_id: externalId, event, status: transaction.status || null, gross_amount: Number.isFinite(Number(transaction.grossAmount)) ? Number(transaction.grossAmount) : null, currency: transaction.currency || null, payment_method: transaction.paymentMethod || null, customer_name: transaction.customer?.name || null, customer_email: transaction.customer?.email || null, payload, occurred_at: payload.timestamp || new Date().toISOString() })
  });
  if (!databaseResponse.ok) return json(request, { error: "Não foi possível registrar o evento." }, 500);
  return new Response(null, { status: 204, headers: corsHeaders(request) });
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const route = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "status";
  try {
    if (route === "status" && request.method === "GET") {
      const result = summary(await loadConfig());
      return json(request, { provider: "Navenaut", configured: result.configured, webhookConfigured: result.webhookConfigured, environment: result.environment });
    }
    if (route === "config" && ["GET", "POST"].includes(request.method)) return await handleConfig(request);
    if (route === "create-intent" && request.method === "POST") return await handleCreateIntent(request);
    if (route === "webhook" && request.method === "POST") return await handleWebhook(request);
    return json(request, { error: "Rota não encontrada." }, 404);
  } catch {
    return json(request, { error: "Não foi possível processar a solicitação." }, 503);
  }
});

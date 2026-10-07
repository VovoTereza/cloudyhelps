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
const loadProviderConfig = async (providerName: string) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/gateway_credentials?provider=eq.${encodeURIComponent(providerName)}&select=encrypted_config&limit=1`, { headers: serviceHeaders });
  if (!response.ok) throw new Error("Não foi possível carregar as credenciais do provedor.");
  const rows = await response.json();
  return rows[0]?.encrypted_config ? await decrypt(rows[0].encrypted_config) : null;
};
const loadConfig = () => loadProviderConfig(provider);
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
  const marketingConsent = body.marketingConsent === true;
  const submittedTracking = body.trackingContext && typeof body.trackingContext === "object" ? body.trackingContext : {};
  const trackingContext = Object.fromEntries(["fbp", "fbc", "ttclid", "ttp", "gclid", "googleClientId", "userAgent", "pageUrl"].map((key) => [key, String(submittedTracking[key] || "").slice(0, key === "pageUrl" ? 1000 : 500)]));
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
  const leadResponse = await fetch(`${supabaseUrl}/rest/v1/payment_leads?on_conflict=request_id`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      request_id: requestId,
      email,
      donor_name: name,
      amount,
      currency: "USD",
      marketing_consent: marketingConsent,
      tracking_context: trackingContext,
      payment_intent_id: payment.paymentIntentId || null,
      created_at: new Date().toISOString()
    })
  });
  if (!leadResponse.ok) return json(request, { error: "Não foi possível vincular os dados do doador ao pagamento." }, 503);
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

const campaignUrl = "https://cloudyhelps.vercel.app/";
const followUpTemplates = [
  { day: 3, subject: "Your kindness is already part of Jessica's story", copy: "Your earlier gift showed Jessica's family they are not facing this alone. Treatment brings ongoing costs for scans, medication, travel, and daily care. If you feel able to help again, another contribution can extend that support. There is no pressure—your first gift already mattered." },
  { day: 4, subject: "One more step can make a real difference", copy: "Serious illness is not a single-day challenge. Each appointment and stage of care can bring new expenses. If your circumstances allow, another gift can help Jessica's family keep moving forward with more support." },
  { day: 5, subject: "Why continued support matters", copy: "Ongoing treatment often means repeated appointments, prescriptions, transportation, and everyday needs. Your support helps the family face those demands. A second contribution, of any size, can keep that circle of care strong." },
  { day: 6, subject: "You helped create breathing room", copy: "Your donation helped create a little more room for Jessica's family to focus on care rather than costs. If you would like to build on that kindness, you can support the campaign again today." },
  { day: 7, subject: "A week of hope, made possible by people like you", copy: "A week has passed since your generous support. Compassion from people like you helps Jessica's family feel surrounded by a community that cares. If you can, one more gift can continue that encouragement." },
  { day: 8, subject: "Help keep Jessica surrounded by care", copy: "Support can mean a ride to treatment, a prescription covered, or one less bill competing for attention. Your first gift was meaningful. Another contribution can help sustain that care." },
  { day: 9, subject: "Your support reaches beyond one treatment", copy: "Cancer care affects every part of daily life. Donations can help ease treatment-related and household pressures while Jessica and her family navigate this difficult season. If you are able, please consider helping again." },
  { day: 10, subject: "If you can, stand with Jessica once more", copy: "Your first donation was an act of real compassion. If you are in a position to give again, another gift can help the family meet the continuing needs that come with treatment." },
  { day: 11, subject: "Together, small acts become lasting support", copy: "No single donor has to carry the whole burden. When caring people come together, each act of generosity becomes part of something larger. If it feels right for you, you can add another gift today." },
  { day: 12, subject: "One final note of gratitude", copy: "Thank you again for standing with Jessica. This is the final reminder in this series. If you would like to make one more gift, your continued support will be received with deep gratitude." }
];
const escapeHtml = (value: unknown) => String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
const firstName = (value: unknown) => String(value || "Friend").trim().split(/\s+/)[0] || "Friend";
const formatMoney = (amount: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
const emailHtml = (name: string, copy: string, buttonLabel: string, unsubscribeUrl = "") => `<!doctype html><html lang="en"><body style="margin:0;background:#f3f7f9;font-family:Arial,sans-serif;color:#102038"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7f9;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #dce6eb;border-radius:20px;overflow:hidden"><tr><td style="padding:36px"><p style="margin:0 0 24px;color:#0787bb;font-weight:700">Cloudy Impact</p><h1 style="margin:0 0 18px;font-size:28px;line-height:1.2">Hi ${escapeHtml(name)},</h1><p style="margin:0 0 26px;font-size:17px;line-height:1.65;color:#44536a">${escapeHtml(copy)}</p><a href="${campaignUrl}" style="display:inline-block;background:#078fc5;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px">${escapeHtml(buttonLabel)}</a>${unsubscribeUrl ? `<p style="margin:30px 0 0;font-size:12px;line-height:1.5;color:#788497">You are receiving this message because you chose to receive campaign updates. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#59687d">Unsubscribe from future reminders</a>.</p>` : ""}</td></tr></table></td></tr></table></body></html>`;
const emailText = (name: string, copy: string, buttonLabel: string, unsubscribeUrl = "") => `Hi ${name},\n\n${copy}\n\n${buttonLabel}: ${campaignUrl}${unsubscribeUrl ? `\n\nUnsubscribe from future reminders: ${unsubscribeUrl}` : ""}`;

const sendResendEmail = async (config: Record<string, any>, payload: Record<string, unknown>, idempotencyKey: string) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: config.from, ...payload })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(result.message || "Não foi possível enviar o e-mail pela Resend.");
  return String(result.id);
};

const findPaymentLead = async (transaction: Record<string, any>, grossAmount: number, currency: string) => {
  const email = String(transaction.customer?.email || "").trim().toLowerCase();
  const paymentIntentId = String(transaction.paymentIntentId || transaction.payment_intent_id || "").trim();
  const filter = paymentIntentId
    ? `payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}`
    : email ? `email=eq.${encodeURIComponent(email)}&amount=eq.${grossAmount}&currency=eq.${encodeURIComponent(currency)}` : "";
  if (!filter) return null;
  const response = await fetch(`${supabaseUrl}/rest/v1/payment_leads?${filter}&select=email,donor_name,marketing_consent,tracking_context&order=created_at.desc&limit=1`, { headers: serviceHeaders });
  if (!response.ok) throw new Error("Não foi possível localizar os dados do doador.");
  return (await response.json())[0] || null;
};

const patchEmailSequence = async (externalId: string, values: Record<string, unknown>) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/donor_email_sequences?external_id=eq.${encodeURIComponent(externalId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(values)
  });
  if (!response.ok) throw new Error("Não foi possível atualizar a sequência de e-mails.");
};

const sha256 = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "").trim().toLowerCase())))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const withoutEmpty = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== null && item !== undefined));
const destinationId = (platform: string, entry: Record<string, any>) => platform === "meta" ? entry.pixelId : platform === "google" ? entry.measurementId : entry.pixelCode;

const sendPaidConversion = async (platform: string, entry: Record<string, any>, conversion: Record<string, any>) => {
  let response: Response;
  if (platform === "meta") {
    const userData = withoutEmpty({
      em: [conversion.emailHash],
      fn: conversion.firstNameHash ? [conversion.firstNameHash] : undefined,
      ln: conversion.lastNameHash ? [conversion.lastNameHash] : undefined,
      fbp: conversion.context.fbp,
      fbc: conversion.context.fbc,
      client_user_agent: conversion.context.userAgent
    });
    response = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(entry.pixelId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${entry.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ data: [{
        event_name: "Purchase",
        event_time: conversion.eventTime,
        event_id: conversion.externalId,
        action_source: "website",
        event_source_url: conversion.context.pageUrl || campaignUrl,
        user_data: userData,
        custom_data: { currency: conversion.currency, value: conversion.value, content_name: "Donation to Jessica's campaign", content_type: "product", contents: [{ id: "donation", quantity: 1, item_price: conversion.value }] }
      }] })
    });
  } else if (platform === "google") {
    response = await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(entry.measurementId)}&api_secret=${encodeURIComponent(entry.apiSecret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: conversion.context.googleClientId || `${conversion.eventTime}.${Math.abs(conversion.externalId.split("").reduce((sum: number, character: string) => sum + character.charCodeAt(0), 0))}`,
        user_id: conversion.emailHash,
        user_data: { sha256_email_address: conversion.emailHash },
        timestamp_micros: conversion.eventTime * 1_000_000,
        events: [{ name: "purchase", params: { transaction_id: conversion.externalId, currency: conversion.currency, value: conversion.value, items: [{ item_id: "donation", item_name: "Donation to Jessica's campaign", price: conversion.value, quantity: 1 }] } }]
      })
    });
  } else {
    response = await fetch("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
      method: "POST",
      headers: { "Access-Token": entry.accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        event_source: "web",
        event_source_id: entry.pixelCode,
        data: [{
          event: "Purchase",
          event_time: conversion.eventTime,
          event_id: conversion.externalId,
          user: withoutEmpty({ email: conversion.emailHash, external_id: conversion.emailHash, ttp: conversion.context.ttp, ttclid: conversion.context.ttclid }),
          page: { url: conversion.context.pageUrl || campaignUrl },
          properties: { currency: conversion.currency, value: conversion.value, content_type: "product", contents: [{ content_id: "donation", content_name: "Donation to Jessica's campaign", quantity: 1, price: conversion.value }] }
        }]
      })
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (platform === "tiktok" && Number(payload.code) !== 0) || (platform === "meta" && !Number(payload.events_received))) {
    throw new Error(String(payload.error?.message || payload.message || `Falha HTTP ${response.status}`).slice(0, 500));
  }
};

const recordTrackingDispatch = async (externalId: string, platform: string, entry: Record<string, any>, status: "sent" | "failed", error = "") => {
  const id = String(destinationId(platform, entry));
  const existingResponse = await fetch(`${supabaseUrl}/rest/v1/tracking_dispatches?external_id=eq.${encodeURIComponent(externalId)}&platform=eq.${platform}&destination_id=eq.${encodeURIComponent(id)}&select=attempts&limit=1`, { headers: serviceHeaders });
  const existing = existingResponse.ok ? (await existingResponse.json())[0] : null;
  const response = await fetch(`${supabaseUrl}/rest/v1/tracking_dispatches?on_conflict=external_id,platform,destination_id`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ external_id: externalId, platform, destination_id: id, status, attempts: Number(existing?.attempts || 0) + 1, last_error: error || null, sent_at: status === "sent" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("Não foi possível registrar o envio da conversão.");
};

const processPaidTracking = async (transaction: Record<string, any>, externalId: string) => {
  const config = await loadProviderConfig("tracking");
  if (!config) return;
  const grossAmount = Number(transaction.grossAmount);
  const currency = String(transaction.currency || "USD").toUpperCase();
  if (!Number.isInteger(grossAmount) || grossAmount <= 0 || !/^[A-Z]{3}$/.test(currency)) return;
  const lead = await findPaymentLead(transaction, grossAmount, currency);
  const email = String(lead?.email || transaction.customer?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const fullName = String(lead?.donor_name || transaction.customer?.name || "").trim().split(/\s+/).filter(Boolean);
  const conversion = {
    externalId,
    eventTime: Math.floor(Date.now() / 1000),
    currency,
    value: grossAmount / 100,
    emailHash: await sha256(email),
    firstNameHash: fullName[0] ? await sha256(fullName[0]) : "",
    lastNameHash: fullName.length > 1 ? await sha256(fullName.at(-1)) : "",
    context: lead?.tracking_context || {}
  };
  const failures: string[] = [];
  for (const platform of ["meta", "google", "tiktok"]) {
    for (const entry of (config[platform] || []).filter((item: Record<string, any>) => item.enabled !== false)) {
      const id = String(destinationId(platform, entry));
      const previousResponse = await fetch(`${supabaseUrl}/rest/v1/tracking_dispatches?external_id=eq.${encodeURIComponent(externalId)}&platform=eq.${platform}&destination_id=eq.${encodeURIComponent(id)}&status=eq.sent&select=status&limit=1`, { headers: serviceHeaders });
      if (previousResponse.ok && (await previousResponse.json()).length) continue;
      try {
        await sendPaidConversion(platform, entry, conversion);
        await recordTrackingDispatch(externalId, platform, entry, "sent");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha desconhecida.";
        await recordTrackingDispatch(externalId, platform, entry, "failed", message).catch(() => {});
        failures.push(`${platform}:${id}`);
      }
    }
  }
  if (failures.length) throw new Error(`Conversões pendentes: ${failures.join(", ")}`);
};

const processPaidDonorEmail = async (transaction: Record<string, any>, externalId: string) => {
  const config = await loadProviderConfig("resend");
  if (!config?.apiKey || !config?.from) return;
  const grossAmount = Number(transaction.grossAmount);
  const currency = String(transaction.currency || "USD").toUpperCase();
  if (!Number.isInteger(grossAmount) || grossAmount <= 0) return;
  const lead = await findPaymentLead(transaction, grossAmount, currency);
  const donorEmail = String(lead?.email || transaction.customer?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donorEmail)) return;
  const donorName = String(lead?.donor_name || transaction.customer?.name || "Friend").trim();

  const sequenceUrl = `${supabaseUrl}/rest/v1/donor_email_sequences?external_id=eq.${encodeURIComponent(externalId)}&select=*`;
  let response = await fetch(sequenceUrl, { headers: serviceHeaders });
  if (!response.ok) throw new Error("Não foi possível consultar a sequência de e-mails.");
  let sequence = (await response.json())[0];
  if (!sequence) {
    const createdAt = new Date().toISOString();
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/donor_email_sequences?on_conflict=external_id`, {
      method: "POST",
      headers: { ...serviceHeaders, Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({
        external_id: externalId,
        donor_email: donorEmail,
        donor_name: donorName,
        gross_amount: grossAmount,
        currency,
        marketing_consent: lead?.marketing_consent === true,
        unsubscribe_token: crypto.randomUUID(),
        scheduled_email_ids: [],
        created_at: createdAt
      })
    });
    if (!insertResponse.ok) throw new Error("Não foi possível criar a sequência de e-mails.");
    sequence = (await insertResponse.json())[0];
    if (!sequence) {
      response = await fetch(sequenceUrl, { headers: serviceHeaders });
      sequence = (await response.json())[0];
    }
  }
  if (!sequence || sequence.unsubscribed_at) return;

  const greetingName = firstName(donorName);
  if (!sequence.thank_you_email_id) {
    const amount = formatMoney(grossAmount, currency);
    const copy = `Thank you for your generous donation of ${amount}. Your kindness helps Jessica's family face treatment-related expenses with more support and less uncertainty. We're deeply grateful you chose to stand with her.`;
    const thankYouId = await sendResendEmail(config, {
      to: [donorEmail],
      subject: "Thank you for standing with Jessica",
      html: emailHtml(greetingName, copy, "Visit Jessica's campaign"),
      text: emailText(greetingName, copy, "Visit Jessica's campaign"),
      tags: [{ name: "category", value: "donation_thank_you" }]
    }, `cloudy-thank-you-${externalId}`);
    await patchEmailSequence(externalId, { thank_you_email_id: thankYouId });
  }

  if (grossAmount < 20000 || currency !== "USD" || sequence.marketing_consent !== true) return;
  const existingIds = Array.isArray(sequence.scheduled_email_ids) ? sequence.scheduled_email_ids : [];
  if (existingIds.length >= followUpTemplates.length) return;
  const unsubscribeUrl = `${campaignUrl}api/email/unsubscribe?token=${sequence.unsubscribe_token}`;
  const baseTime = new Date(sequence.created_at || Date.now()).getTime();
  const scheduledIds = [...existingIds];
  for (let index = existingIds.length; index < followUpTemplates.length; index += 1) {
    const template = followUpTemplates[index];
    const scheduledAt = new Date(baseTime + template.day * 24 * 60 * 60 * 1000).toISOString();
    const emailId = await sendResendEmail(config, {
      to: [donorEmail],
      subject: template.subject,
      html: emailHtml(greetingName, template.copy, "Support Jessica again", unsubscribeUrl),
      text: emailText(greetingName, template.copy, "Support Jessica again", unsubscribeUrl),
      scheduled_at: scheduledAt,
      tags: [{ name: "category", value: "donor_followup" }, { name: "sequence_day", value: String(template.day) }]
    }, `cloudy-follow-up-${externalId}-${template.day}`);
    scheduledIds.push(emailId);
    await patchEmailSequence(externalId, { scheduled_email_ids: scheduledIds });
  }
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
  if (event === "transaction.paid") {
    const outcomes = await Promise.allSettled([
      processPaidTracking(transaction, externalId),
      processPaidDonorEmail(transaction, externalId)
    ]);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
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

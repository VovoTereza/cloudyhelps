const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const encryptionSecret = Deno.env.get("GATEWAY_CONFIG_ENCRYPTION_KEY") || serviceKey;
const provider = "resend";

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
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
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(JSON.stringify(value))));
  return `v1.${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
};
const decrypt = async (value: string) => {
  const [version, encodedIv, encodedCiphertext] = String(value || "").split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new Error("Configuração criptografada inválida.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(encodedIv) }, await encryptionKey(), fromBase64Url(encodedCiphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
};

const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
const loadConfig = async () => {
  const response = await fetch(`${supabaseUrl}/rest/v1/gateway_credentials?provider=eq.${provider}&select=encrypted_config&limit=1`, { headers: serviceHeaders });
  if (!response.ok) throw new Error("Não foi possível carregar a configuração da Resend.");
  const rows = await response.json();
  return rows[0]?.encrypted_config ? await decrypt(rows[0].encrypted_config) : null;
};
const summary = (config: Record<string, string> | null) => ({
  configured: Boolean(config?.apiKey && config?.domain && config?.from),
  apiKeyConfigured: Boolean(config?.apiKey),
  domain: config?.domain || "",
  from: config?.from || "",
  templateCount: 11,
  followUpCount: 10,
  followUpStartsOnDay: 3,
  minimumDonation: 200
});
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
  if (!userId) return json({ error: "Sessão administrativa inválida ou expirada." }, 401);
  const current = await loadConfig();
  if (request.method === "GET") return json(summary(current));

  const body = await request.json().catch(() => ({}));
  const apiKey = String(body.apiKey || current?.apiKey || "").trim();
  if (!/^re_[A-Za-z0-9_-]{12,}$/.test(apiKey)) return json({ error: "Informe uma chave de API válida da Resend." }, 422);
  const domainsResponse = await fetch("https://api.resend.com/domains?limit=100", { headers: { Authorization: `Bearer ${apiKey}` } });
  const domainsPayload = await domainsResponse.json().catch(() => ({}));
  if (!domainsResponse.ok) return json({ error: domainsPayload.message || "A chave da Resend não pôde ser validada." }, 422);
  const domains = domainsPayload.data || [];
  const domain = domains.find((item: Record<string, string>) => item.status === "verified")?.name || "";
  if (!domain) return json({ error: "A conta Resend ainda não possui um domínio verificado para envio." }, 422);

  const next = { apiKey, domain, from: `Cloudy Impact <donations@${domain}>` };
  const response = await fetch(`${supabaseUrl}/rest/v1/gateway_credentials?on_conflict=provider`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      provider,
      encrypted_config: await encrypt(next),
      environment: "production",
      configured_fields: { apiKey: true, domain: true, templates: 11 },
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
  });
  if (!response.ok) return json({ error: "Não foi possível salvar a configuração da Resend." }, 503);
  return json(summary(next));
};

const unsubscribePage = (message: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences | Cloudy Impact</title><style>body{margin:0;background:#f4f7f9;color:#101d32;font:16px/1.6 Inter,Arial,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px}.card{max-width:560px;padding:40px;border:1px solid #dfe5e9;border-radius:22px;background:#fff;text-align:center;box-shadow:0 16px 40px rgba(22,40,61,.09)}h1{margin:0 0 12px;font-size:28px}p{margin:0;color:#647083}a{display:inline-block;margin-top:24px;color:#006b9d;font-weight:700}</style></head><body><main class="card"><h1>Email preferences updated</h1><p>${message}</p><a href="https://cloudyhelps.vercel.app/">Return to the campaign</a></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const handleUnsubscribe = async (request: Request) => {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return unsubscribePage("This unsubscribe link is invalid.");
  const sequenceResponse = await fetch(`${supabaseUrl}/rest/v1/donor_email_sequences?unsubscribe_token=eq.${token}&select=scheduled_email_ids,unsubscribed_at&limit=1`, { headers: serviceHeaders });
  const rows = sequenceResponse.ok ? await sequenceResponse.json() : [];
  const sequence = rows[0];
  if (!sequence) return unsubscribePage("This email preference record could not be found.");
  if (sequence.unsubscribed_at) return unsubscribePage("You are already unsubscribed from future campaign reminders.");

  await fetch(`${supabaseUrl}/rest/v1/donor_email_sequences?unsubscribe_token=eq.${token}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ unsubscribed_at: new Date().toISOString() })
  });
  const config = await loadConfig().catch(() => null);
  if (config?.apiKey) {
    await Promise.allSettled((sequence.scheduled_email_ids || []).map((id: string) => fetch(`https://api.resend.com/emails/${id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }
    })));
  }
  return unsubscribePage("You will not receive any more scheduled campaign reminders. Thank you for your support.");
};

Deno.serve(async (request) => {
  const route = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "config";
  try {
    if (route === "config" && ["GET", "POST"].includes(request.method)) return await handleConfig(request);
    if (route === "unsubscribe" && request.method === "GET") return await handleUnsubscribe(request);
    return json({ error: "Rota não encontrada." }, 404);
  } catch {
    return json({ error: "Não foi possível processar a solicitação." }, 503);
  }
});

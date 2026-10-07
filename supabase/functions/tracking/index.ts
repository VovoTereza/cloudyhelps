const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const encryptionSecret = Deno.env.get("GATEWAY_CONFIG_ENCRYPTION_KEY") || serviceKey;
const provider = "tracking";

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
  if (!response.ok) throw new Error("Não foi possível carregar a configuração de rastreamento.");
  const rows = await response.json();
  return rows[0]?.encrypted_config ? await decrypt(rows[0].encrypted_config) : { meta: [], google: [], tiktok: [] };
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

const publicEntry = (platform: string, entry: Record<string, any>) => ({
  id: entry.id,
  label: entry.label,
  enabled: entry.enabled !== false,
  destinationId: platform === "meta" ? entry.pixelId : platform === "google" ? entry.measurementId : entry.pixelCode,
  secretConfigured: Boolean(platform === "google" ? entry.apiSecret : entry.accessToken)
});
const summary = (config: Record<string, any>) => {
  const platforms = Object.fromEntries(["meta", "google", "tiktok"].map((platform) => [platform, (config[platform] || []).map((entry: Record<string, any>) => publicEntry(platform, entry))]));
  const total = Object.values(platforms).reduce((sum: number, entries: any) => sum + entries.length, 0);
  return { configured: total > 0, total, platforms };
};
const destinationPattern = {
  meta: /^\d{5,30}$/,
  google: /^G-[A-Z0-9]{4,20}$/i,
  tiktok: /^[A-Z0-9]{8,40}$/i
};
const normalizeEntries = (platform: "meta" | "google" | "tiktok", input: unknown, current: Record<string, any>[]) => {
  if (!Array.isArray(input) || input.length > 20) throw new Error(`A lista ${platform} é inválida ou excede 20 destinos.`);
  const currentById = new Map(current.map((entry) => [entry.id, entry]));
  return input.map((raw: Record<string, any>, index: number) => {
    const id = /^[0-9a-f-]{36}$/i.test(String(raw.id || "")) ? String(raw.id) : crypto.randomUUID();
    const previous = currentById.get(id) || {};
    const label = String(raw.label || "").trim().slice(0, 60);
    const destinationId = String(raw.destinationId || "").trim();
    const secret = String(raw.secret || "").trim() || (platform === "google" ? previous.apiSecret : previous.accessToken) || "";
    if (!label) throw new Error(`Informe um nome para o destino ${index + 1} da ${platform}.`);
    if (!destinationPattern[platform].test(destinationId)) throw new Error(`O identificador do destino ${label} é inválido.`);
    if (secret.length < 8 || secret.length > 1000) throw new Error(`Informe a credencial privada do destino ${label}.`);
    const common = { id, label, enabled: raw.enabled !== false };
    if (platform === "meta") return { ...common, pixelId: destinationId, accessToken: secret };
    if (platform === "google") return { ...common, measurementId: destinationId.toUpperCase(), apiSecret: secret };
    return { ...common, pixelCode: destinationId.toUpperCase(), accessToken: secret };
  });
};

const handleConfig = async (request: Request) => {
  const userId = await requireAdmin(request);
  if (!userId) return json({ error: "Sessão administrativa inválida ou expirada." }, 401);
  const current = await loadConfig();
  if (request.method === "GET") return json(summary(current));
  const body = await request.json().catch(() => ({}));
  let next;
  try {
    next = {
      meta: normalizeEntries("meta", body.platforms?.meta || [], current.meta || []),
      google: normalizeEntries("google", body.platforms?.google || [], current.google || []),
      tiktok: normalizeEntries("tiktok", body.platforms?.tiktok || [], current.tiktok || [])
    };
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Configuração inválida." }, 422);
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/gateway_credentials?on_conflict=provider`, {
    method: "POST",
    headers: { ...serviceHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      provider,
      encrypted_config: await encrypt(next),
      environment: "production",
      configured_fields: { meta: next.meta.length, google: next.google.length, tiktok: next.tiktok.length },
      updated_at: new Date().toISOString(),
      updated_by: userId
    })
  });
  if (!response.ok) return json({ error: "Não foi possível salvar a configuração de rastreamento." }, 503);
  return json(summary(next));
};

Deno.serve(async (request) => {
  const route = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "config";
  try {
    if (route === "config" && ["GET", "POST"].includes(request.method)) return await handleConfig(request);
    return json({ error: "Rota não encontrada." }, 404);
  } catch {
    return json({ error: "Não foi possível processar a solicitação." }, 503);
  }
});

import crypto from "node:crypto";

const PROVIDER = "navenaut";
const fallbackSupabaseUrl = "https://ojwshgpvijmbcjyiggxl.supabase.co";
const fallbackPublishableKey = "sb_publishable_jESyYbVDaDejhlzkjJ4kfw_iQVvYHY7";

const getSupabase = () => ({
  url: String(process.env.SUPABASE_URL || fallbackSupabaseUrl).replace(/\/$/, ""),
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || fallbackPublishableKey,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || ""
});

const encryptionKey = () => {
  const value = process.env.GATEWAY_CONFIG_ENCRYPTION_KEY || "";
  if (!value) throw new Error("GATEWAY_CONFIG_ENCRYPTION_KEY não configurada.");
  return crypto.createHash("sha256").update(value).digest();
};

const encrypt = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
};

const decrypt = (value) => {
  const [version, iv, tag, ciphertext] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Credenciais criptografadas inválidas.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8"));
};

const serviceHeaders = () => {
  const { serviceKey } = getSupabase();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada.");
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };
};

export const requireAdmin = async (request) => {
  const authorization = String(request.headers.authorization || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const { url, publishableKey } = getSupabase();
  const response = await fetch(`${url}/rest/v1/rpc/is_campaign_admin`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: authorization,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  if (!response.ok || !(await response.json().catch(() => false))) return null;

  const token = authorization.slice(7);
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return { id: /^[0-9a-f-]{36}$/i.test(payload.sub || "") ? payload.sub : null };
  } catch {
    return { id: null };
  }
};

export const loadGatewayConfig = async () => {
  const { url } = getSupabase();
  const response = await fetch(`${url}/rest/v1/gateway_credentials?provider=eq.${PROVIDER}&select=encrypted_config&limit=1`, {
    headers: serviceHeaders(),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Não foi possível carregar as credenciais do gateway.");
  const rows = await response.json();
  return rows[0]?.encrypted_config ? decrypt(rows[0].encrypted_config) : null;
};

export const saveGatewayConfig = async (config, userId) => {
  const { url } = getSupabase();
  const environment = config.publicKey.startsWith("pk_live_") ? "live" : config.publicKey.startsWith("pk_test_") ? "test" : "unconfigured";
  const response = await fetch(`${url}/rest/v1/gateway_credentials?on_conflict=provider`, {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      provider: PROVIDER,
      encrypted_config: encrypt(config),
      environment,
      configured_fields: {
        publicKey: Boolean(config.publicKey),
        secretKey: Boolean(config.secretKey),
        webhookSecret: Boolean(config.webhookSecret),
        productId: Boolean(config.productId)
      },
      updated_at: new Date().toISOString(),
      updated_by: userId || null
    })
  });
  if (!response.ok) throw new Error("Não foi possível salvar as credenciais do gateway.");
};

export const gatewaySummary = (config) => ({
  configured: Boolean(config?.publicKey && config?.secretKey),
  webhookConfigured: Boolean(config?.webhookSecret),
  environment: config?.publicKey?.startsWith("pk_live_") ? "live" : config?.publicKey?.startsWith("pk_test_") ? "test" : "unconfigured",
  publicKey: config?.publicKey || "",
  secretKeyConfigured: Boolean(config?.secretKey),
  webhookSecretConfigured: Boolean(config?.webhookSecret),
  productId: config?.productId || ""
});

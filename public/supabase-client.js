(() => {
  const config = window.CloudySupabaseConfig || {};
  const baseUrl = String(config.url || "").replace(/\/$/, "");
  const apiBase = String(config.proxyPath || baseUrl).replace(/\/$/, "");
  const apiKey = String(config.publishableKey || "");
  const sessionKey = "cloudySupabaseSession";

  if (!baseUrl || !apiKey) {
    console.error("Supabase runtime configuration is missing.");
  }

  const readSession = () => {
    try { return JSON.parse(localStorage.getItem(sessionKey) || "null"); } catch { return null; }
  };
  const writeSession = (session) => {
    if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
    else localStorage.removeItem(sessionKey);
  };

  const request = async (pathname, options = {}, accessToken = "") => {
    const response = await fetch(`${apiBase}${pathname}`, {
      ...options,
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${accessToken || apiKey}`,
        ...(options.body && !(options.body instanceof Blob) && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers
      }
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  };

  const normalizeSession = (payload) => ({
    ...payload,
    expires_at: payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600)
  });

  const auth = {
    async signIn(email, password) {
      const session = normalizeSession(await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password })
      }));
      writeSession(session);
      return session;
    },
    async getSession() {
      let session = readSession();
      if (!session?.access_token || !session?.refresh_token) return null;
      if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return session;
      try {
        session = normalizeSession(await request("/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          body: JSON.stringify({ refresh_token: session.refresh_token })
        }));
        writeSession(session);
        return session;
      } catch {
        writeSession(null);
        return null;
      }
    },
    async isAdmin(session = null) {
      const activeSession = session || await this.getSession();
      if (!activeSession?.access_token) return false;
      return Boolean(await request("/rest/v1/rpc/is_campaign_admin", {
        method: "POST",
        body: JSON.stringify({})
      }, activeSession.access_token));
    },
    async signOut() {
      const session = readSession();
      try {
        if (session?.access_token) await request("/auth/v1/logout", { method: "POST" }, session.access_token);
      } finally {
        writeSession(null);
      }
    }
  };

  const campaign = {
    async load() {
      const rows = await request("/rest/v1/campaign_content?select=data&id=eq.main&limit=1");
      return Array.isArray(rows) ? rows[0]?.data || null : null;
    },
    async save(data) {
      const session = await auth.getSession();
      if (!session) throw new Error("Your admin session expired. Sign in again.");
      const rows = await request("/rest/v1/campaign_content?id=eq.main", {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ data, updated_at: new Date().toISOString(), updated_by: session.user?.id || null })
      }, session.access_token);
      if (!Array.isArray(rows) || !rows.length) throw new Error("This account is not authorized to edit the campaign.");
      return rows[0].data;
    }
  };

  const storage = {
    async uploadCampaignImage(file) {
      const session = await auth.getSession();
      if (!session) throw new Error("Your admin session expired. Sign in again.");
      const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const objectName = `campaign-${Date.now()}.${extension}`;
      await request(`/storage/v1/object/campaign-media/${objectName}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        body: file
      }, session.access_token);
      return `${baseUrl}/storage/v1/object/public/campaign-media/${objectName}`;
    }
  };

  window.CloudySupabase = Object.freeze({ auth, campaign, storage, configured: Boolean(baseUrl && apiKey) });
})();

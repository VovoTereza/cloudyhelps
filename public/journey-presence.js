const config = window.CloudySupabaseConfig;
const channelName = "journey-live-presence";
const validSessionId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

const makeClient = () => config?.url && config?.publishableKey && window.supabase?.createClient
  ? window.supabase.createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 2 } }
    })
  : null;

const track = (sessionId) => {
  if (!validSessionId(sessionId)) return () => {};
  const client = makeClient();
  if (!client) return () => {};

  let subscribed = false;
  let stopped = false;
  const channel = client.channel(channelName, { config: { presence: { key: sessionId } } });
  const payload = () => ({ session_id: sessionId, page: location.pathname, online_at: new Date().toISOString() });
  const announce = () => {
    if (!stopped && subscribed && document.visibilityState === "visible") channel.track(payload()).catch(() => {});
  };
  const withdraw = () => {
    if (subscribed) channel.untrack().catch(() => {});
  };
  const onVisibility = () => document.visibilityState === "visible" ? announce() : withdraw();
  const onPageShow = () => announce();

  channel.subscribe((status) => {
    subscribed = status === "SUBSCRIBED";
    if (subscribed) announce();
  });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", withdraw);

  return () => {
    if (stopped) return;
    stopped = true;
    withdraw();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", withdraw);
    client.removeChannel(channel).catch(() => {});
  };
};

const subscribe = (callback) => {
  const client = makeClient();
  if (!client || typeof callback !== "function") return () => {};
  let stopped = false;
  const channel = client.channel(channelName);
  const publishState = () => {
    if (stopped) return;
    callback(new Set(Object.keys(channel.presenceState()).filter(validSessionId)));
  };
  channel.on("presence", { event: "sync" }, publishState);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") publishState();
    if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) callback(new Set());
  });
  return () => {
    if (stopped) return;
    stopped = true;
    client.removeChannel(channel).catch(() => {});
  };
};

window.CloudyJourneyPresence = Object.freeze({ track, subscribe });

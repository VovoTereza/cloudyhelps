import * as MapLibreGL from "/vendor/maplibre-gl.mjs";

MapLibreGL.setWorkerUrl("/vendor/maplibre-gl-worker.mjs");

const lightMapStyle = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors"
    }
  },
  layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap", minzoom: 0, maxzoom: 19 }]
};

(() => {
  if (document.body.dataset.adminPage !== "overview") return;
  const stageRank = { offer: 1, checkout: 2, paid: 3 };
  const stageLabel = { offer: "Oferta visualizada", checkout: "Checkout iniciado", paid: "Pagamento aprovado" };
  const stageStatus = { offer: "OFERTA VISTA", checkout: "NO CHECKOUT", paid: "PAGAMENTO APROVADO" };
  const stageHeadline = { offer: "Visualizou a campanha", checkout: "Iniciou o checkout seguro", paid: "Pagamento confirmado" };
  const stageDescription = {
    offer: "A página pública da campanha foi carregada nesta sessão.",
    checkout: "Os dados foram validados e uma cobrança real foi criada pelo gateway.",
    paid: "O webhook assinado confirmou o recebimento desta doação."
  };
  const refs = Object.fromEntries([
    "data-error", "overview-sync-label", "overview-clock", "map-target-city", "map-target-ip", "map-coords", "map-empty", "map-presence-dot", "metric-sessions", "metric-conversion", "metric-revenue", "lead-avatar", "lead-name", "lead-flag", "lead-device", "lead-status", "journey-progress-fill", "stage-headline", "stage-subline", "lead-source", "lead-ip", "lead-value", "lead-time", "feed-container", "feed-counter", "refresh-overview", "map-focus"
  ].map((id) => [id, document.getElementById(id)]));
  let events = [];
  let activeSessionIds = new Set();
  let selectedSessionId = "";
  let activeFilter = "all";
  let map = null;
  let mapLoaded = false;
  let mapError = "";
  let markers = [];
  let loading = false;

  const money = (amount, currency = "USD") => new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(Number(amount || 0) / 100);
  const dateTime = (value) => value ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—";
  const initials = (name) => String(name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
  const flag = (code) => /^[A-Z]{2}$/.test(String(code || "")) ? String(code).toUpperCase().replace(/./g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0))) : "";
  const deviceName = (userAgent) => {
    const ua = String(userAgent || "");
    const device = /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS/i.test(ua) ? "Mac" : ua ? "Dispositivo web" : "Dispositivo não identificado";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Navegador";
    return `${device} · ${browser}`;
  };
  const sessionEvents = (sessionId) => events.filter((event) => event.session_id === sessionId).sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const sessionIsActive = (sessionId) => activeSessionIds.has(sessionId);
  const latestPerSession = () => {
    const latest = new Map();
    events.forEach((event) => { if (!latest.has(event.session_id)) latest.set(event.session_id, event); });
    return Array.from(latest.values());
  };
  const eventWithLocation = (sessionId) => sessionEvents(sessionId).slice().reverse().find((event) => Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude)));
  const currentSession = () => {
    const grouped = sessionEvents(selectedSessionId);
    const highest = grouped.slice().sort((a, b) => stageRank[b.stage] - stageRank[a.stage] || new Date(b.occurred_at) - new Date(a.occurred_at))[0];
    const identity = grouped.slice().reverse().find((event) => event.donor_name || event.donor_email) || highest;
    return { grouped, highest, identity, location: eventWithLocation(selectedSessionId) };
  };

  const renderMetrics = () => {
    const uniqueSessions = new Set(events.map((event) => event.session_id)).size;
    const offers = new Set(events.filter((event) => event.stage === "offer").map((event) => event.session_id)).size;
    const paidEvents = events.filter((event) => event.stage === "paid");
    const paidSessions = new Set(paidEvents.map((event) => event.session_id)).size;
    const revenue = paidEvents.filter((event) => (event.currency || "USD") === "USD").reduce((sum, event) => sum + Number(event.amount || 0), 0);
    refs["metric-sessions"].textContent = String(uniqueSessions);
    refs["metric-conversion"].textContent = offers ? `${((paidSessions / offers) * 100).toFixed(1).replace(".", ",")}%` : "—";
    refs["metric-revenue"].textContent = money(revenue, "USD");
  };
  const renderCurrent = () => {
    if (!selectedSessionId || !events.length) {
      refs["lead-avatar"].textContent = "—";
      refs["lead-name"].textContent = "Nenhum evento registrado";
      refs["lead-flag"].textContent = "";
      refs["lead-device"].textContent = "Aguardando atividade real";
      refs["lead-status"].textContent = "SEM DADOS";
      refs["lead-status"].removeAttribute("data-stage");
      refs["map-presence-dot"].classList.add("is-inactive");
      refs["journey-progress-fill"].style.width = "0";
      refs["stage-headline"].textContent = "Aguardando atividade";
      refs["stage-subline"].textContent = "Os dados aparecerão após uma visita real à campanha.";
      ["lead-source", "lead-ip", "lead-value", "lead-time"].forEach((id) => { refs[id].textContent = "—"; });
      return;
    }
    const { highest, identity, location } = currentSession();
    const activeNow = sessionIsActive(selectedSessionId);
    const name = identity?.donor_name || (identity?.donor_email ? identity.donor_email.replace(/(^.).*(@.*$)/, "$1•••$2") : "Visitante anônimo");
    refs["lead-avatar"].textContent = initials(name);
    refs["lead-name"].textContent = name;
    refs["lead-flag"].textContent = flag(location?.country_code || highest.country_code);
    refs["lead-flag"].setAttribute("aria-label", highest.country_code ? `País ${highest.country_code}` : "");
    refs["lead-device"].textContent = deviceName(identity?.device || highest.device);
    refs["lead-status"].textContent = stageStatus[highest.stage];
    refs["lead-status"].dataset.stage = highest.stage;
    refs["journey-progress-fill"].style.width = `${stageRank[highest.stage] * 33.333}%`;
    refs["stage-headline"].textContent = stageHeadline[highest.stage];
    refs["stage-subline"].textContent = stageDescription[highest.stage];
    refs["lead-source"].textContent = highest.source || "Direto / não identificado";
    refs["lead-ip"].textContent = location?.ip_masked || highest.ip_masked || "Não disponível";
    refs["lead-value"].textContent = highest.amount ? money(highest.amount, highest.currency) : "Ainda não definido";
    refs["lead-time"].textContent = dateTime(highest.occurred_at);
    refs["map-target-city"].textContent = location?.city ? `${location.city}${location.country_code ? `, ${location.country_code}` : ""}` : "Localização não disponível";
    refs["map-target-ip"].textContent = `${location?.ip_masked ? `IP: ${location.ip_masked}` : "IP não armazenado"} · ${activeNow ? "ativo agora" : "sessão encerrada"}`;
    refs["map-presence-dot"].classList.toggle("is-inactive", !activeNow);
    refs["map-coords"].textContent = location ? `${Number(location.latitude).toFixed(4)}, ${Number(location.longitude).toFixed(4)}` : "Sem coordenadas";
  };
  const selectSession = (sessionId, focusMap = true) => {
    selectedSessionId = sessionId;
    renderCurrent();
    renderFeed();
    renderMarkers();
    if (focusMap) focusSelected();
  };
  const renderFeed = () => {
    const filtered = events.filter((event) => activeFilter === "all" || event.stage === activeFilter).slice(0, 40);
    refs["feed-container"].replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.className = "journey-empty";
      empty.textContent = activeFilter === "all" ? "Nenhum evento real registrado ainda." : "Nenhum evento real nesta etapa.";
      refs["feed-container"].append(empty);
    } else {
      filtered.forEach((event) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `journey-feed-item${event.session_id === selectedSessionId ? " is-selected" : ""}`;
        item.dataset.stage = event.stage;
        item.setAttribute("aria-label", `${stageLabel[event.stage]} em ${event.city || "local não identificado"}`);
        const dot = document.createElement("i");
        dot.setAttribute("aria-hidden", "true");
        const copy = document.createElement("span");
        copy.className = "journey-feed-copy";
        const title = document.createElement("strong");
        title.textContent = event.donor_name || "Visitante anônimo";
        const detail = document.createElement("span");
        detail.textContent = `${event.city || "Local não identificado"} · ${event.source || "Origem não identificada"}`;
        copy.append(title, detail);
        const meta = document.createElement("span");
        meta.className = "journey-feed-meta";
        const badge = document.createElement("b");
        badge.textContent = stageLabel[event.stage];
        const time = document.createElement("time");
        time.dateTime = event.occurred_at;
        time.textContent = dateTime(event.occurred_at);
        meta.append(badge, time);
        item.append(dot, copy, meta);
        item.addEventListener("click", () => selectSession(event.session_id));
        refs["feed-container"].append(item);
      });
    }
    refs["feed-counter"].textContent = `${filtered.length} ${filtered.length === 1 ? "evento" : "eventos"}`;
  };

  const renderMarkers = () => {
    markers.forEach((marker) => marker.remove());
    markers = [];
    if (!mapLoaded) {
      renderMapState();
      return;
    }
    latestPerSession().forEach((event) => {
      if (!sessionIsActive(event.session_id)) return;
      const located = eventWithLocation(event.session_id);
      if (!located) return;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `journey-marker journey-marker--${event.stage}${event.session_id === selectedSessionId ? " is-selected" : ""}`;
      element.setAttribute("aria-label", `${stageLabel[event.stage]} em ${located.city || "local aproximado"}`);
      element.title = `${stageLabel[event.stage]} · ${located.city || "Local aproximado"}`;
      element.addEventListener("click", () => selectSession(event.session_id));
      const marker = new MapLibreGL.Marker({ element, anchor: "center" })
        .setLngLat([Number(located.longitude), Number(located.latitude)])
        .addTo(map);
      markers.push(marker);
    });
    renderMapState();
  };
  const renderMapState = () => {
    const activeLocated = latestPerSession().some((event) => sessionIsActive(event.session_id) && eventWithLocation(event.session_id));
    refs["map-empty"].textContent = mapError || "Nenhum visitante ativo no mapa agora.";
    refs["map-empty"].hidden = activeLocated && !mapError;
  };
  const focusSelected = () => {
    if (!mapLoaded || !selectedSessionId || !sessionIsActive(selectedSessionId)) return;
    const located = eventWithLocation(selectedSessionId);
    if (!located) return;
    map.flyTo({ center: [Number(located.longitude), Number(located.latitude)], zoom: 7, speed: 1.1, essential: false });
  };

  const initMap = () => {
    if (map) return;
    try {
      map = new MapLibreGL.Map({
        container: "journey-map",
        style: lightMapStyle,
        center: [-54, -15],
        zoom: 2.6,
        minZoom: 1.5,
        attributionControl: false,
        cooperativeGestures: true
      });
      map.addControl(new MapLibreGL.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new MapLibreGL.AttributionControl({ compact: true }), "bottom-left");
      map.on("load", () => {
        mapLoaded = true;
        mapError = "";
        renderCurrent();
        renderMarkers();
        focusSelected();
      });
      map.on("error", () => {
        if (mapLoaded) return;
        mapError = "Não foi possível carregar o mapa-base. Os eventos continuam disponíveis no feed.";
        renderCurrent();
        renderMapState();
      });
      new ResizeObserver(() => map?.resize()).observe(document.querySelector(".journey-map-shell"));
    } catch {
      mapError = "Não foi possível iniciar o mapa. Os eventos continuam disponíveis no feed.";
      renderCurrent();
      renderMapState();
    }
  };

  const loadOverview = async (silent = false) => {
    if (loading) return;
    loading = true;
    if (!silent) refs["overview-sync-label"].textContent = "Sincronizando…";
    try {
      const session = await window.CloudySupabase.auth.getSession();
      if (!session?.access_token) return;
      const response = await fetch("/api/journey/overview", { headers: { Accept: "application/json", Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os dados da jornada.");
      events = Array.isArray(payload.events) ? payload.events : [];
      if (!selectedSessionId || !events.some((event) => event.session_id === selectedSessionId)) selectedSessionId = events[0]?.session_id || "";
      renderMetrics();
      renderCurrent();
      renderFeed();
      renderMarkers();
      refs["overview-sync-label"].textContent = events.length ? "Dados reais atualizados" : "Aguardando o primeiro evento";
      refs["data-error"].hidden = true;
    } catch (error) {
      refs["overview-sync-label"].textContent = "Falha na sincronização";
      refs["data-error"].textContent = error.message || "Não foi possível carregar os dados da jornada.";
      refs["data-error"].hidden = false;
    } finally { loading = false; }
  };

  document.querySelectorAll(".journey-filter").forEach((button) => button.addEventListener("click", () => {
    activeFilter = button.dataset.stage;
    document.querySelectorAll(".journey-filter").forEach((item) => {
      const active = item === button;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    const next = events.find((event) => activeFilter === "all" || event.stage === activeFilter);
    if (next) selectedSessionId = next.session_id;
    renderCurrent();
    renderFeed();
    renderMarkers();
    focusSelected();
  }));
  refs["refresh-overview"].addEventListener("click", () => loadOverview(false));
  refs["map-focus"].addEventListener("click", focusSelected);
  const updateClock = () => { refs["overview-clock"].textContent = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }); };
  updateClock();
  setInterval(updateClock, 1000);
  initMap();
  loadOverview(false);
  const unsubscribePresence = window.CloudyJourneyPresence?.subscribe((sessionIds) => {
    activeSessionIds = sessionIds;
    renderCurrent();
    renderMarkers();
  });
  window.addEventListener("pagehide", () => unsubscribePresence?.(), { once: true });
  setInterval(() => loadOverview(true), 5000);
})();

(async () => {
  let session = null;
  let authorized = false;
  try {
    session = await window.CloudySupabase.auth.getSession();
    authorized = Boolean(session && await window.CloudySupabase.auth.isAdmin(session));
  } catch {
    authorized = false;
  }
  if (!authorized) {
    if (session) await window.CloudySupabase.auth.signOut();
    window.location.replace("/admin-login.html");
    return;
  }

  const page = document.body.dataset.adminPage;
  const store = window.CloudyCampaignStore;
  const form = document.querySelector("#campaign-form");
  const saveState = document.querySelector("#save-state");
  const toast = document.querySelector("#toast");
  const dataError = document.querySelector("#data-error");
  let data;
  let toastTimer;

  const sidebar = document.querySelector("#sidebar");
  const backdrop = document.querySelector("#sidebar-backdrop");
  const menuButton = document.querySelector("#menu-button");
  const closeMenu = () => {
    sidebar.classList.remove("is-open");
    backdrop.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  };
  menuButton.addEventListener("click", () => {
    const open = !sidebar.classList.contains("is-open");
    sidebar.classList.toggle("is-open", open);
    backdrop.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  });
  backdrop.addEventListener("click", closeMenu);
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", closeMenu));
  document.querySelector("#logout-button").addEventListener("click", () => {
    window.CloudySupabase.auth.signOut();
    window.location.replace("/admin-login.html");
  });

  document.body.classList.remove("auth-pending");
  if (page === "gateway") {
    const status = document.querySelector("#gateway-status");
    const statusText = document.querySelector("#gateway-status-text");
    const webhookState = document.querySelector("#gateway-webhook-state");
    const productsState = document.querySelector("#gateway-products-state");
    const productSyncNote = document.querySelector("#product-sync-note");
    const note = document.querySelector("#gateway-note");
    const gatewayForm = document.querySelector("#gateway-form");
    const formMessage = document.querySelector("#gateway-form-message");
    const saveButton = document.querySelector("#save-gateway");
    const gatewayToast = document.querySelector("#gateway-toast");
    let currentConfig = null;

    const renderGateway = (gateway) => {
      status.classList.toggle("is-ready", gateway.configured);
      status.classList.toggle("is-pending", !gateway.configured);
      statusText.textContent = gateway.configured ? "Pronto para pagamentos" : "Aguardando credenciais";
      webhookState.textContent = gateway.webhookConfigured ? "Configurado automaticamente" : "Aguardando configuração";
      const productSync = gateway.productSync || { linked: 0, total: 0, missing: [] };
      productsState.textContent = productSync.total ? `${productSync.linked} de ${productSync.total} vinculados` : "Aguardando sincronização";
      document.querySelector("#gateway-environment").textContent = gateway.environment === "live" ? "Produção" : gateway.environment === "test" ? "Teste" : "Não configurado";
      note.textContent = gateway.configured
        ? "A integração está ativa. O checkout cria pagamentos pelo backend seguro da Vercel."
        : "Cadastre as credenciais abaixo para ativar os pagamentos no checkout.";
      document.querySelector("#naut-public-key").value = gateway.publicKey || "";
      document.querySelector("#naut-secret-key").placeholder = gateway.secretKeyConfigured ? "Configurada — deixe em branco para manter" : "sk_live_…";
      if (gateway.secretKeyConfigured) document.querySelector("#secret-key-help").textContent = "Chave configurada. Preencha somente para substituí-la.";
      productSyncNote.classList.toggle("is-complete", productSync.total > 0 && productSync.linked === productSync.total);
      productSyncNote.classList.toggle("is-warning", productSync.missing?.length > 0);
      productSyncNote.textContent = productSync.missing?.length
        ? `Cobranças por valor estão liberadas. Para também registrar o productId na Navenaut, publique estes produtos: ${productSync.missing.join(", ")}.`
        : productSync.total
          ? "Todos os níveis de doação estão vinculados a produtos publicados da Navenaut."
          : "Os produtos são vinculados automaticamente quando existirem, sem bloquear cobranças por valor.";
    };

    const configRequest = async (options = {}) => {
      const response = await fetch("/api/navenaut/config", {
        ...options,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível acessar a configuração do gateway.");
      return payload;
    };

    try {
      currentConfig = await configRequest();
      renderGateway(currentConfig);
    } catch (error) {
      status.classList.add("is-pending");
      statusText.textContent = "Não foi possível verificar";
      webhookState.textContent = "Indisponível";
      formMessage.textContent = error.message;
      formMessage.hidden = false;
    }

    gatewayForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      formMessage.hidden = true;
      saveButton.disabled = true;
      saveButton.textContent = "Salvando…";
      const values = new FormData(gatewayForm);
      try {
        currentConfig = await configRequest({
          method: "POST",
          body: JSON.stringify({
            publicKey: values.get("publicKey"),
            secretKey: values.get("secretKey")
          })
        });
        document.querySelector("#naut-secret-key").value = "";
        renderGateway(currentConfig);
        gatewayToast.hidden = false;
        setTimeout(() => { gatewayToast.hidden = true; }, 3200);
      } catch (error) {
        formMessage.textContent = error.message;
        formMessage.hidden = false;
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Salvar credenciais";
      }
    });

    document.querySelector("#copy-webhook").addEventListener("click", async () => {
      const feedback = document.querySelector("#copy-feedback");
      try {
        await navigator.clipboard.writeText(document.querySelector("#webhook-url").textContent.trim());
        feedback.textContent = "URL copiada.";
      } catch {
        feedback.textContent = "Selecione e copie a URL manualmente.";
      }
    });
    return;
  }
  if (page === "apis") {
    const status = document.querySelector("#resend-status");
    const statusText = document.querySelector("#resend-status-text");
    const domain = document.querySelector("#resend-domain");
    const from = document.querySelector("#resend-from");
    const apiKey = document.querySelector("#resend-api-key");
    const keyHelp = document.querySelector("#resend-key-help");
    const resendForm = document.querySelector("#resend-form");
    const formMessage = document.querySelector("#resend-form-message");
    const saveButton = document.querySelector("#save-resend");
    const resendToast = document.querySelector("#resend-toast");

    const configRequest = async (options = {}) => {
      const response = await fetch("/api/resend/config", {
        ...options,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível acessar a configuração da Resend.");
      return payload;
    };
    const render = (config) => {
      status.classList.toggle("is-ready", config.configured);
      status.classList.toggle("is-pending", !config.configured);
      statusText.textContent = config.configured ? "Pronta para envios" : "Aguardando chave";
      domain.textContent = config.domain || "Não configurado";
      from.textContent = config.from || "Não configurado";
      apiKey.placeholder = config.apiKeyConfigured ? "Configurada — deixe em branco para manter" : "re_…";
      if (config.apiKeyConfigured) keyHelp.textContent = "Chave configurada. Preencha somente para substituí-la.";
    };

    try { render(await configRequest()); }
    catch (error) {
      status.classList.add("is-pending");
      statusText.textContent = "Não foi possível verificar";
      domain.textContent = "Indisponível";
      from.textContent = "Indisponível";
      formMessage.textContent = error.message;
      formMessage.hidden = false;
    }

    resendForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      formMessage.hidden = true;
      saveButton.disabled = true;
      saveButton.textContent = "Validando…";
      try {
        const config = await configRequest({ method: "POST", body: JSON.stringify({ apiKey: apiKey.value }) });
        apiKey.value = "";
        render(config);
        resendToast.hidden = false;
        setTimeout(() => { resendToast.hidden = true; }, 3200);
      } catch (error) {
        formMessage.textContent = error.message;
        formMessage.hidden = false;
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Salvar e validar";
      }
    });
    return;
  }
  if (page === "tracking") {
    const trackingForm = document.querySelector("#tracking-form");
    const formMessage = document.querySelector("#tracking-form-message");
    const saveButton = document.querySelector("#save-tracking");
    const trackingToast = document.querySelector("#tracking-toast");
    const totalLabel = document.querySelector("#tracking-total");
    const platforms = ["meta", "google", "tiktok"];
    const platformLabels = { meta: "Meta", google: "Google", tiktok: "TikTok" };
    const destinationLabels = { meta: "Pixel ID", google: "Measurement ID", tiktok: "Pixel Code" };
    const destinationPlaceholders = { meta: "123456789012345", google: "G-XXXXXXXXXX", tiktok: "XXXXXXXXXXXXXX" };
    const secretLabels = { meta: "Access token", google: "API secret", tiktok: "Access token" };
    let currentConfig = { platforms: { meta: [], google: [], tiktok: [] } };

    const configRequest = async (options = {}) => {
      const response = await fetch("/api/tracking/config", {
        ...options,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.access_token}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers
        }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível acessar a configuração de trackeamento.");
      return payload;
    };
    const createField = (labelText, value, options = {}) => {
      const wrapper = document.createElement("div");
      wrapper.className = "field";
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.id = `tracking-${crypto.randomUUID()}`;
      input.value = value || "";
      input.type = options.type || "text";
      input.name = options.name;
      input.placeholder = options.placeholder || "";
      input.required = options.required !== false;
      input.maxLength = options.maxLength || 1000;
      input.autocomplete = "off";
      if (options.className) input.className = options.className;
      label.htmlFor = input.id;
      label.textContent = labelText;
      wrapper.append(label, input);
      return wrapper;
    };
    const collectPlatforms = () => Object.fromEntries(platforms.map((platform) => [platform, Array.from(document.querySelector(`#tracking-${platform}`).children)
      .filter((row) => row.classList.contains("tracking-row"))
      .map((row) => ({
        id: row.dataset.id,
        label: row.querySelector('[name="label"]').value,
        destinationId: row.querySelector('[name="destinationId"]').value,
        secret: row.querySelector('[name="secret"]').value,
        secretConfigured: row.dataset.secretConfigured === "true",
        enabled: row.querySelector('[name="enabled"]').checked
      }))]));
    const render = () => {
      let total = 0;
      platforms.forEach((platform) => {
        const container = document.querySelector(`#tracking-${platform}`);
        const entries = currentConfig.platforms?.[platform] || [];
        total += entries.length;
        container.replaceChildren();
        if (!entries.length) {
          const empty = document.createElement("p");
          empty.className = "tracking-empty";
          empty.textContent = `Nenhum destino da ${platformLabels[platform]} configurado.`;
          container.append(empty);
          return;
        }
        entries.forEach((entry) => {
          const row = document.createElement("div");
          row.className = "tracking-row";
          row.dataset.id = entry.id || crypto.randomUUID();
          row.dataset.secretConfigured = String(entry.secretConfigured === true);
          const nameField = createField("Nome interno", entry.label, { name: "label", placeholder: `${platformLabels[platform]} principal`, maxLength: 60 });
          const destinationField = createField(destinationLabels[platform], entry.destinationId, { name: "destinationId", placeholder: destinationPlaceholders[platform], maxLength: 40 });
          const secretField = createField(secretLabels[platform], entry.secret, { name: "secret", type: "password", placeholder: entry.secretConfigured ? "Configurado — deixe vazio para manter" : "Credencial privada", required: !entry.secretConfigured, className: "tracking-secret" });
          const actions = document.createElement("div");
          actions.className = "tracking-row-actions";
          const toggle = document.createElement("label");
          toggle.className = "tracking-toggle";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.name = "enabled";
          checkbox.checked = entry.enabled !== false;
          toggle.append(checkbox, document.createTextNode("Ativo"));
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "remove-button";
          remove.setAttribute("aria-label", `Remover ${entry.label || "destino"} da ${platformLabels[platform]}`);
          remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
          remove.addEventListener("click", () => {
            currentConfig.platforms = collectPlatforms();
            currentConfig.platforms[platform] = currentConfig.platforms[platform].filter((item) => item.id !== row.dataset.id);
            render();
          });
          actions.append(toggle, remove);
          row.append(nameField, destinationField, secretField, actions);
          container.append(row);
        });
      });
      totalLabel.textContent = `${total} ${total === 1 ? "configurado" : "configurados"}`;
    };

    document.querySelectorAll("[data-add-platform]").forEach((button) => button.addEventListener("click", () => {
      currentConfig.platforms = collectPlatforms();
      const platform = button.dataset.addPlatform;
      if (currentConfig.platforms[platform].length >= 20) {
        formMessage.textContent = "Cada plataforma aceita no máximo 20 destinos.";
        formMessage.hidden = false;
        return;
      }
      currentConfig.platforms[platform].push({ id: crypto.randomUUID(), label: "", destinationId: "", secret: "", secretConfigured: false, enabled: true });
      render();
      document.querySelector(`#tracking-${platform} .tracking-row:last-child input`)?.focus();
    }));

    try {
      currentConfig = await configRequest();
      render();
    } catch (error) {
      formMessage.textContent = error.message;
      formMessage.hidden = false;
      render();
    }

    trackingForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      formMessage.hidden = true;
      if (!trackingForm.reportValidity()) return;
      saveButton.disabled = true;
      saveButton.textContent = "Salvando…";
      try {
        const saved = await configRequest({ method: "POST", body: JSON.stringify({ platforms: collectPlatforms() }) });
        currentConfig = saved;
        render();
        trackingToast.hidden = false;
        setTimeout(() => { trackingToast.hidden = true; }, 3200);
      } catch (error) {
        formMessage.textContent = error.message;
        formMessage.hidden = false;
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Salvar trackeamento";
      }
    });
    return;
  }
  if (page === "overview") return;

  try {
    data = await store.loadProduction();
  } catch {
    dataError.textContent = "Não foi possível carregar os dados de produção do Supabase. Recarregue a página e tente novamente.";
    dataError.hidden = false;
    form?.querySelectorAll("input, textarea, button").forEach((element) => { element.disabled = true; });
    return;
  }

  const setValue = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.value = value ?? "";
  };
  const markDirty = () => {
    if (!saveState) return;
    saveState.textContent = "Alterações não salvas";
    saveState.classList.add("is-dirty");
  };
  const showSaved = () => {
    if (saveState) {
      saveState.textContent = "Dados sincronizados";
      saveState.classList.remove("is-dirty");
    }
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = "Alterações salvas no Supabase e publicadas na campanha.";
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  };
  const save = async (patch) => {
    const buttons = document.querySelectorAll('[type="submit"][form="campaign-form"], #campaign-form [type="submit"]');
    buttons.forEach((button) => { button.disabled = true; });
    try {
      data = await store.save({ ...data, ...patch });
      showSaved();
    } catch {
      alert("Não foi possível salvar no Supabase. Verifique sua sessão e tente novamente.");
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  };

  const field = (label, name, value = "", options = {}) => {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const labelElement = document.createElement("label");
    labelElement.textContent = label;
    const input = options.textarea ? document.createElement("textarea") : document.createElement("input");
    input.name = name;
    input.value = value ?? "";
    if (options.type) input.type = options.type;
    if (options.min !== undefined) input.min = options.min;
    if (options.step !== undefined) input.step = options.step;
    if (options.maxLength) input.maxLength = options.maxLength;
    if (options.textarea) input.rows = 2;
    input.id = `${name}-${crypto.randomUUID()}`;
    labelElement.htmlFor = input.id;
    wrapper.append(labelElement, input);
    return wrapper;
  };
  const rowIndex = (index) => {
    const span = document.createElement("span");
    span.className = "row-index";
    span.textContent = String(index + 1).padStart(2, "0");
    return span;
  };
  const removeButton = (label, onRemove) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-button";
    button.setAttribute("aria-label", label);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
    button.addEventListener("click", onRemove);
    return button;
  };
  const readRows = (container, mapper) => Array.from(container.children).map(mapper);
  form.addEventListener("input", markDirty);

  if (page === "campaign") {
    const photoInput = document.querySelector("#campaign-photo");
    const photoPreview = document.querySelector("#photo-preview");
    setValue("#campaign-name", data.title);
    setValue("#campaign-intro", data.intro);
    setValue("#campaign-raised", data.raised);
    setValue("#campaign-goal", data.goal);
    setValue("#campaign-status", data.status);
    setValue("#organizer-name", data.organizerName);
    setValue("#organizer-role", data.organizerRole);
    setValue("#campaign-story", data.story);
    setValue("#campaign-photo", data.photo);
    photoPreview.src = data.photo || "/assets/jessica-family.png";
    photoInput.addEventListener("input", () => { photoPreview.src = photoInput.value.trim() || "/assets/jessica-family.png"; });
    document.querySelector("#photo-upload").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) {
        alert("Escolha uma imagem menor que 3 MB.");
        event.target.value = "";
        return;
      }
      event.target.disabled = true;
      try {
        const publicUrl = await window.CloudySupabase.storage.uploadCampaignImage(file);
        photoInput.value = publicUrl;
        photoPreview.src = publicUrl;
        markDirty();
      } catch {
        alert("Não foi possível enviar a imagem.");
      } finally {
        event.target.disabled = false;
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      await save({
        title: document.querySelector("#campaign-name").value.trim(), intro: document.querySelector("#campaign-intro").value.trim(),
        raised: Number(document.querySelector("#campaign-raised").value), goal: Number(document.querySelector("#campaign-goal").value),
        status: document.querySelector("#campaign-status").value.trim(), organizerName: document.querySelector("#organizer-name").value.trim(),
        organizerRole: document.querySelector("#organizer-role").value.trim(), story: document.querySelector("#campaign-story").value.trim(), photo: photoInput.value.trim()
      });
    });
    return;
  }

  if (page === "donations") {
    const tiersList = document.querySelector("#tiers-list");
    data.tiers.forEach((tier) => {
      const row = document.createElement("div");
      row.className = "repeat-row tier-row";
      row.append(field("Valor", "amount", tier.amount, { type: "number", min: 1, step: 1 }), field("Título", "title", tier.title, { maxLength: 55 }), field("Descrição", "description", tier.description, { maxLength: 180 }), field("Selo", "badge", tier.badge, { maxLength: 22 }));
      tiersList.append(row);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const tiers = readRows(tiersList, (row) => ({ amount: Number(row.querySelector('[name="amount"]').value), title: row.querySelector('[name="title"]').value.trim(), description: row.querySelector('[name="description"]').value.trim(), badge: row.querySelector('[name="badge"]').value.trim() }));
      if (!tiers.length || tiers.some((tier) => !tier.title || tier.amount <= 0)) { alert("Todos os níveis precisam de título e valor positivo."); return; }
      await save({ tiers });
    });
    return;
  }

  const faqsList = document.querySelector("#faqs-list");
  const messagesList = document.querySelector("#messages-list");
  const renderFaqs = () => {
    faqsList.replaceChildren();
    data.faqs.forEach((faq, index) => {
      const row = document.createElement("div");
      row.className = "repeat-row faq-row";
      row.append(rowIndex(index), field("Pergunta", "question", faq.question, { maxLength: 120 }), field("Resposta", "answer", faq.answer, { textarea: true, maxLength: 500 }), removeButton(`Remover pergunta ${index + 1}`, () => { data.faqs.splice(index, 1); renderFaqs(); markDirty(); }));
      faqsList.append(row);
    });
  };
  const renderMessages = () => {
    messagesList.replaceChildren();
    data.messages.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "repeat-row message-row";
      row.append(rowIndex(index), field("Nome", "name", item.name, { maxLength: 60 }), field("Valor", "amount", item.amount, { type: "number", min: 0, step: 1 }), field("Data", "date", item.date, { maxLength: 40 }), field("Mensagem", "message", item.message, { textarea: true, maxLength: 320 }), removeButton(`Remover mensagem ${index + 1}`, () => { data.messages.splice(index, 1); renderMessages(); markDirty(); }));
      messagesList.append(row);
    });
  };
  const readCommunity = () => ({
    faqs: readRows(faqsList, (row) => ({ question: row.querySelector('[name="question"]').value.trim(), answer: row.querySelector('[name="answer"]').value.trim() })).filter((item) => item.question && item.answer),
    messages: readRows(messagesList, (row) => ({ name: row.querySelector('[name="name"]').value.trim() || "Anônimo", amount: Number(row.querySelector('[name="amount"]').value || 0), date: row.querySelector('[name="date"]').value.trim(), message: row.querySelector('[name="message"]').value.trim() })).filter((item) => item.message)
  });
  renderFaqs();
  renderMessages();
  document.querySelector("#add-faq").addEventListener("click", () => { data.faqs = readCommunity().faqs; data.faqs.push({ question: "", answer: "" }); renderFaqs(); markDirty(); });
  document.querySelector("#add-message").addEventListener("click", () => { data.messages = readCommunity().messages; data.messages.push({ name: "Anônimo", amount: 0, date: "", message: "" }); renderMessages(); markDirty(); });
  form.addEventListener("submit", async (event) => { event.preventDefault(); await save(readCommunity()); });
})();

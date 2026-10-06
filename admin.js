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
      webhookState.textContent = gateway.webhookConfigured ? "Assinatura configurada" : "Aguardando segredo";
      document.querySelector("#gateway-environment").textContent = gateway.environment === "live" ? "Produção" : gateway.environment === "test" ? "Teste" : "Não configurado";
      note.textContent = gateway.configured
        ? "A integração está ativa. O checkout cria pagamentos pelo backend seguro da Vercel."
        : "Cadastre as credenciais abaixo para ativar os pagamentos no checkout.";
      document.querySelector("#naut-public-key").value = gateway.publicKey || "";
      document.querySelector("#naut-product-id").value = gateway.productId || "";
      document.querySelector("#naut-secret-key").placeholder = gateway.secretKeyConfigured ? "Configurada — deixe em branco para manter" : "sk_live_…";
      document.querySelector("#naut-webhook-secret").placeholder = gateway.webhookSecretConfigured ? "Configurado — deixe em branco para manter" : "Segredo de assinatura";
      if (gateway.secretKeyConfigured) document.querySelector("#secret-key-help").textContent = "Chave configurada. Preencha somente para substituí-la.";
      if (gateway.webhookSecretConfigured) document.querySelector("#webhook-secret-help").textContent = "Segredo configurado. Preencha somente para substituí-lo.";
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
            secretKey: values.get("secretKey"),
            webhookSecret: values.get("webhookSecret"),
            productId: values.get("productId")
          })
        });
        document.querySelector("#naut-secret-key").value = "";
        document.querySelector("#naut-webhook-secret").value = "";
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

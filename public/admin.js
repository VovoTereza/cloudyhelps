(async () => {
  const session = await window.CloudySupabase.auth.getSession();
  if (!session || !await window.CloudySupabase.auth.isAdmin(session)) {
    if (session) await window.CloudySupabase.auth.signOut();
    window.location.replace("/admin-login.html");
    return;
  }
  document.body.classList.remove("auth-pending");

  const store = window.CloudyCampaignStore;
  const form = document.querySelector("#campaign-form");
  const tiersList = document.querySelector("#tiers-list");
  const faqsList = document.querySelector("#faqs-list");
  const messagesList = document.querySelector("#messages-list");
  const toast = document.querySelector("#toast");
  const saveState = document.querySelector("#save-state");
  const photoInput = document.querySelector("#campaign-photo");
  const photoPreview = document.querySelector("#photo-preview");
  let data = await store.load();
  let toastTimer;

  const iconTrash = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"/></svg>';
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
    labelElement.htmlFor = `${name}-${Math.random().toString(36).slice(2)}`;
    input.id = labelElement.htmlFor;
    wrapper.append(labelElement, input);
    return wrapper;
  };

  const removeButton = (label, onRemove) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "remove-button";
    button.setAttribute("aria-label", label);
    button.innerHTML = iconTrash;
    button.addEventListener("click", onRemove);
    return button;
  };

  const rowIndex = (index) => {
    const span = document.createElement("span");
    span.className = "row-index";
    span.textContent = String(index + 1).padStart(2, "0");
    return span;
  };

  const markDirty = () => {
    saveState.textContent = "Alterações não salvas";
    saveState.classList.add("is-dirty");
  };

  const renderTiers = () => {
    tiersList.replaceChildren();
    data.tiers.slice(0, 6).forEach((tier, index) => {
      const row = document.createElement("div");
      row.className = "repeat-row tier-row";
      row.dataset.index = index;
      row.append(
        field("Valor", "amount", tier.amount, { type: "number", min: 1, step: 1 }),
        field("Título", "title", tier.title, { maxLength: 55 }),
        field("Descrição", "description", tier.description, { maxLength: 180 }),
        field("Selo", "badge", tier.badge, { maxLength: 22 })
      );
      tiersList.append(row);
    });
  };

  const renderFaqs = () => {
    faqsList.replaceChildren();
    data.faqs.forEach((faq, index) => {
      const row = document.createElement("div");
      row.className = "repeat-row faq-row";
      row.dataset.index = index;
      row.append(
        rowIndex(index),
        field("Pergunta", "question", faq.question, { maxLength: 120 }),
        field("Resposta", "answer", faq.answer, { textarea: true, maxLength: 500 }),
        removeButton(`Remover pergunta ${index + 1}`, () => {
          data.faqs.splice(index, 1);
          renderFaqs();
          markDirty();
        })
      );
      faqsList.append(row);
    });
  };

  const renderMessages = () => {
    messagesList.replaceChildren();
    data.messages.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "repeat-row message-row";
      row.dataset.index = index;
      row.append(
        rowIndex(index),
        field("Nome", "name", item.name, { maxLength: 60 }),
        field("Valor", "amount", item.amount, { type: "number", min: 0, step: 1 }),
        field("Data", "date", item.date, { maxLength: 40 }),
        field("Mensagem", "message", item.message, { textarea: true, maxLength: 320 }),
        removeButton(`Remover mensagem ${index + 1}`, () => {
          data.messages.splice(index, 1);
          renderMessages();
          updateMetrics();
          markDirty();
        })
      );
      messagesList.append(row);
    });
  };

  const setValue = (selector, value) => { document.querySelector(selector).value = value ?? ""; };
  const money = (value) => `$${Number(value || 0).toLocaleString("en-US")}`;
  const updateMetrics = () => {
    const raised = Number(document.querySelector("#campaign-raised").value || data.raised || 0);
    const goal = Number(document.querySelector("#campaign-goal").value || data.goal || 1);
    document.querySelector("#metric-raised").textContent = money(raised);
    document.querySelector("#metric-goal").textContent = money(goal);
    document.querySelector("#metric-progress").textContent = `${Math.min(100, Math.round((raised / Math.max(goal, 1)) * 100))}% da meta`;
    document.querySelector("#metric-messages").textContent = messagesList.children.length;
  };

  const loadForm = () => {
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
    renderTiers();
    renderFaqs();
    renderMessages();
    updateMetrics();
    saveState.textContent = "Todas as alterações foram salvas";
    saveState.classList.remove("is-dirty");
  };

  const readRows = (container, mapper) => Array.from(container.children).map((row) => mapper(row));
  const readData = () => ({
    title: document.querySelector("#campaign-name").value.trim(),
    intro: document.querySelector("#campaign-intro").value.trim(),
    raised: Number(document.querySelector("#campaign-raised").value),
    goal: Number(document.querySelector("#campaign-goal").value),
    status: document.querySelector("#campaign-status").value.trim(),
    organizerName: document.querySelector("#organizer-name").value.trim(),
    organizerRole: document.querySelector("#organizer-role").value.trim(),
    story: document.querySelector("#campaign-story").value.trim(),
    photo: photoInput.value.trim() || "/assets/jessica-family.png",
    tiers: readRows(tiersList, (row) => ({
      amount: Number(row.querySelector('[name="amount"]').value),
      title: row.querySelector('[name="title"]').value.trim(),
      description: row.querySelector('[name="description"]').value.trim(),
      badge: row.querySelector('[name="badge"]').value.trim()
    })),
    faqs: readRows(faqsList, (row) => ({
      question: row.querySelector('[name="question"]').value.trim(),
      answer: row.querySelector('[name="answer"]').value.trim()
    })).filter((item) => item.question && item.answer),
    messages: readRows(messagesList, (row) => ({
      name: row.querySelector('[name="name"]').value.trim() || "Anônimo",
      amount: Number(row.querySelector('[name="amount"]').value || 0),
      date: row.querySelector('[name="date"]').value.trim(),
      message: row.querySelector('[name="message"]').value.trim()
    })).filter((item) => item.message)
  });

  form.addEventListener("input", (event) => {
    markDirty();
    if (event.target.matches("#campaign-raised, #campaign-goal")) updateMetrics();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const next = readData();
    if (!next.tiers.length || next.tiers.some((tier) => !tier.title || tier.amount <= 0)) {
      alert("Todos os níveis de doação precisam de um título e um valor positivo.");
      return;
    }
    const saveButton = form.querySelector('[type="submit"]');
    saveButton.disabled = true;
    try {
      data = await store.save(next);
      updateMetrics();
      saveState.textContent = "Todas as alterações foram salvas";
      saveState.classList.remove("is-dirty");
      clearTimeout(toastTimer);
      toast.textContent = "Alterações salvas. A campanha publicada está atualizada.";
      toast.hidden = false;
      toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
    } catch {
      alert("Não foi possível salvar a campanha. Verifique sua sessão e tente novamente.");
    } finally {
      saveButton.disabled = false;
    }
  });

  document.querySelector("#add-faq").addEventListener("click", () => {
    data.faqs = readData().faqs;
    data.faqs.push({ question: "", answer: "" });
    renderFaqs();
    faqsList.lastElementChild?.querySelector("input")?.focus();
    markDirty();
  });

  document.querySelector("#add-message").addEventListener("click", () => {
    data.messages = readData().messages;
    data.messages.push({ name: "Anônimo", amount: 0, date: "Recentemente", message: "" });
    renderMessages();
    messagesList.lastElementChild?.querySelector("input")?.focus();
    updateMetrics();
    markDirty();
  });

  photoInput.addEventListener("input", () => {
    photoPreview.src = photoInput.value.trim() || "/assets/jessica-family.png";
  });
  photoPreview.addEventListener("error", () => { photoPreview.src = "/assets/jessica-family.png"; }, { passive: true });

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
      alert("Não foi possível enviar a imagem. Verifique o arquivo e tente novamente.");
      event.target.value = "";
    } finally {
      event.target.disabled = false;
    }
  });

  const resetDialog = document.querySelector("#reset-dialog");
  document.querySelector("#reset-button").addEventListener("click", () => resetDialog.showModal());
  resetDialog.addEventListener("close", async () => {
    if (resetDialog.returnValue !== "confirm") return;
    try {
      data = await store.reset();
      loadForm();
      toast.textContent = "O conteúdo padrão da campanha foi restaurado em produção.";
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = "Alterações salvas. A campanha publicada está atualizada."; }, 3200);
    } catch {
      alert("Não foi possível restaurar a campanha. Tente novamente.");
    }
  });

  document.querySelector("#logout-button").addEventListener("click", async () => {
    await window.CloudySupabase.auth.signOut();
    window.location.replace("/admin-login.html");
  });

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

  const sections = document.querySelectorAll(".admin-section");
  const navLinks = Array.from(document.querySelectorAll(".nav-link"));
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach((link) => link.classList.toggle("is-active", link.hash === `#${visible.target.id}`));
  }, { rootMargin: "-20% 0px -65%", threshold: [0, .25, .6] });
  sections.forEach((section) => observer.observe(section));

  loadForm();
})();

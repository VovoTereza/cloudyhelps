(() => {
  const sessionKey = "cloudyAdminSession";
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
  if (!demoMode && sessionStorage.getItem(sessionKey) !== "active") {
    window.location.replace("/admin-login.html");
    return;
  }

  const store = window.CloudyCampaignStore;
  const form = document.querySelector("#campaign-form");
  const tiersList = document.querySelector("#tiers-list");
  const faqsList = document.querySelector("#faqs-list");
  const messagesList = document.querySelector("#messages-list");
  const toast = document.querySelector("#toast");
  const saveState = document.querySelector("#save-state");
  const photoInput = document.querySelector("#campaign-photo");
  const photoPreview = document.querySelector("#photo-preview");
  let data = store.load();
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
    saveState.textContent = "Unsaved changes";
    saveState.classList.add("is-dirty");
  };

  const renderTiers = () => {
    tiersList.replaceChildren();
    data.tiers.slice(0, 6).forEach((tier, index) => {
      const row = document.createElement("div");
      row.className = "repeat-row tier-row";
      row.dataset.index = index;
      row.append(
        field("Amount", "amount", tier.amount, { type: "number", min: 1, step: 1 }),
        field("Title", "title", tier.title, { maxLength: 55 }),
        field("Description", "description", tier.description, { maxLength: 180 }),
        field("Badge", "badge", tier.badge, { maxLength: 22 })
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
        field("Question", "question", faq.question, { maxLength: 120 }),
        field("Answer", "answer", faq.answer, { textarea: true, maxLength: 500 }),
        removeButton(`Remove question ${index + 1}`, () => {
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
        field("Name", "name", item.name, { maxLength: 60 }),
        field("Amount", "amount", item.amount, { type: "number", min: 0, step: 1 }),
        field("Date", "date", item.date, { maxLength: 40 }),
        field("Message", "message", item.message, { textarea: true, maxLength: 320 }),
        removeButton(`Remove message ${index + 1}`, () => {
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
    document.querySelector("#metric-progress").textContent = `${Math.min(100, Math.round((raised / Math.max(goal, 1)) * 100))}% of goal`;
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
    saveState.textContent = "All changes saved";
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
      name: row.querySelector('[name="name"]').value.trim() || "Anonymous",
      amount: Number(row.querySelector('[name="amount"]').value || 0),
      date: row.querySelector('[name="date"]').value.trim(),
      message: row.querySelector('[name="message"]').value.trim()
    })).filter((item) => item.message)
  });

  form.addEventListener("input", (event) => {
    markDirty();
    if (event.target.matches("#campaign-raised, #campaign-goal")) updateMetrics();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (demoMode) return;
    if (!form.reportValidity()) return;
    const next = readData();
    if (!next.tiers.length || next.tiers.some((tier) => !tier.title || tier.amount <= 0)) {
      alert("Every donation level needs a title and a positive amount.");
      return;
    }
    data = store.save(next);
    updateMetrics();
    saveState.textContent = "All changes saved";
    saveState.classList.remove("is-dirty");
    clearTimeout(toastTimer);
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
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
    data.messages.push({ name: "Anonymous", amount: 0, date: "Recently", message: "" });
    renderMessages();
    messagesList.lastElementChild?.querySelector("input")?.focus();
    updateMetrics();
    markDirty();
  });

  photoInput.addEventListener("input", () => {
    photoPreview.src = photoInput.value.trim() || "/assets/jessica-family.png";
  });
  photoPreview.addEventListener("error", () => { photoPreview.src = "/assets/jessica-family.png"; }, { passive: true });

  document.querySelector("#photo-upload").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert("Choose an image smaller than 3 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      photoInput.value = reader.result;
      photoPreview.src = reader.result;
      markDirty();
    });
    reader.readAsDataURL(file);
  });

  const resetDialog = document.querySelector("#reset-dialog");
  document.querySelector("#reset-button").addEventListener("click", () => resetDialog.showModal());
  resetDialog.addEventListener("close", () => {
    if (resetDialog.returnValue !== "confirm") return;
    data = store.reset();
    loadForm();
    toast.textContent = "Default campaign content restored.";
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = "Changes saved. The campaign preview is up to date."; }, 3200);
  });

  document.querySelector("#logout-button").addEventListener("click", () => {
    if (demoMode) {
      window.location.replace("/admin-login.html");
      return;
    }
    sessionStorage.removeItem(sessionKey);
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

  const enableDemoMode = () => {
    document.body.classList.add("demo-mode");
    document.querySelector("#admin-mode-label").textContent = "Dashboard demo";
    document.querySelector("#mode-banner-title").textContent = "Read-only demonstration";
    document.querySelector("#mode-banner-copy").textContent = "Explore the complete dashboard safely. Editing, uploads, saving, and content removal are unavailable in demo mode.";
    saveState.textContent = "Demo data · read only";

    form.querySelectorAll("input:not([type='file']), textarea").forEach((control) => {
      control.readOnly = true;
      control.setAttribute("aria-readonly", "true");
    });
    document.querySelector("#photo-upload").disabled = true;
    document.querySelectorAll("#campaign-form button, button[form='campaign-form']").forEach((button) => {
      button.disabled = true;
    });
    const uploadButton = document.querySelector(".upload-button");
    uploadButton.setAttribute("aria-disabled", "true");
    document.querySelector("#logout-button").textContent = "Exit demo";
  };

  loadForm();
  if (demoMode) enableDemoMode();
})();

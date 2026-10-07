(() => {
  const attribution = new URLSearchParams(window.location.search);
  ["fbclid", "ttclid", "gclid"].forEach((key) => {
    const value = attribution.get(key);
    if (value && value.length <= 500) {
      try { sessionStorage.setItem(`cloudy_${key}`, value); } catch {}
    }
  });
  const journeySessionId = (() => {
    try {
      const existing = sessionStorage.getItem("cloudyJourneySessionId");
      if (existing) return existing;
      const created = crypto.randomUUID();
      sessionStorage.setItem("cloudyJourneySessionId", created);
      return created;
    } catch { return crypto.randomUUID(); }
  })();
  try {
    if (!sessionStorage.getItem("cloudyJourneyViewSent")) {
      fetch("/api/journey/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          sessionId: journeySessionId,
          fbclid: attribution.get("fbclid") || sessionStorage.getItem("cloudy_fbclid") || "",
          ttclid: attribution.get("ttclid") || sessionStorage.getItem("cloudy_ttclid") || "",
          gclid: attribution.get("gclid") || sessionStorage.getItem("cloudy_gclid") || "",
          utmSource: attribution.get("utm_source") || "",
          userAgent: navigator.userAgent,
          pageUrl: window.location.href
        })
      }).then((response) => { if (response.ok) sessionStorage.setItem("cloudyJourneyViewSent", "true"); }).catch(() => {});
    }
  } catch {}
  window.CloudyJourneyPresence?.track(journeySessionId);
  const amountButtons = Array.from(document.querySelectorAll("button[aria-pressed]"));
  if (!amountButtons.length) return;

  const amountFrom = (button) => {
    const matches = button.textContent.match(/\$(\d[\d,]*)/g);
    return matches ? Number(matches.at(-1).replace(/[$,]/g, "")) : 0;
  };

  const buttonsByAmount = new Map(amountButtons.map((button) => [amountFrom(button), button]));
  const addOn = document.querySelector('button[role="switch"]');
  const donateButton = Array.from(document.querySelectorAll("button")).find((button) =>
    /Donate \$\d/.test(button.textContent)
  );

  const selectedAtLoad = amountButtons.find((button) => button.getAttribute("aria-pressed") === "true");
  const selectedIconAtLoad = selectedAtLoad?.querySelector("div.flex > span.relative");
  const checkTemplate = selectedIconAtLoad?.querySelector(":scope > span.absolute")?.cloneNode(true);
  let selectedAmount = amountFrom(selectedAtLoad || amountButtons[0]);
  let selectedProduct = (selectedAtLoad || amountButtons[0])?.dataset.productName || "Donation";
  let hasAddOn = addOn?.getAttribute("aria-checked") === "true";

  const liveRegion = document.createElement("span");
  liveRegion.className = "sr-only";
  liveRegion.setAttribute("aria-live", "polite");
  amountButtons[0].parentElement?.append(liveRegion);

  const setDonateButtonText = (total) => {
    if (!donateButton) return;
    const textNode = Array.from(donateButton.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && /Donate/.test(node.textContent)
    );
    if (textNode) textNode.textContent = ` Donate $${total} `;
    donateButton.dataset.amount = String(total);
    donateButton.setAttribute("aria-label", `Donate $${total}`);
  };

  const updateTotal = (announce = true) => {
    const total = selectedAmount + (hasAddOn ? 15 : 0);
    setDonateButtonText(total);
    if (announce) liveRegion.textContent = `$${selectedAmount} donation selected${hasAddOn ? ", plus $15 medicine support" : ""}. Total $${total}.`;
    window.dispatchEvent(new CustomEvent("cloudy:donation-selection", {
      detail: { amount: selectedAmount, medicineSupport: hasAddOn, total }
    }));
  };

  donateButton?.addEventListener("click", () => {
    const totalUrl = new URL("/checkout.html", window.location.origin);
    totalUrl.searchParams.set("amount", String(selectedAmount));
    totalUrl.searchParams.set("medicine", hasAddOn ? "1" : "0");
    totalUrl.searchParams.set("product", selectedProduct);
    window.location.href = totalUrl.toString();
  });

  const renderAmountButton = (button, selected) => {
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("border-primary", selected);
    button.classList.toggle("bg-primary-soft/60", selected);
    button.classList.toggle("border-transparent", !selected);
    button.classList.toggle("bg-[#f2f4f6]", !selected);

    const icon = button.querySelector("div.flex > span.relative");
    if (icon) {
      icon.classList.toggle("bg-primary", selected);
      icon.classList.toggle("text-white", selected);
      icon.classList.toggle("bg-white", !selected);
      icon.classList.toggle("text-primary-deep", !selected);
      icon.querySelector(":scope > span.absolute")?.remove();
      if (selected && checkTemplate) icon.append(checkTemplate.cloneNode(true));
    }

    const amount = button.querySelector("div.flex > span:last-child");
    amount?.classList.toggle("text-primary-deep", selected);
    amount?.classList.toggle("text-slate-ink", !selected);

    const detail = button.querySelector("div.grid");
    if (detail) {
      detail.classList.toggle("mt-1", selected);
      detail.classList.toggle("grid-rows-[1fr]", selected);
      detail.classList.toggle("opacity-100", selected);
      detail.classList.toggle("grid-rows-[0fr]", !selected);
      detail.classList.toggle("opacity-0", !selected);
    }
  };

  const selectAmount = (amount, announce = true) => {
    if (!buttonsByAmount.has(amount)) return;
    selectedAmount = amount;
    const selectedButton = buttonsByAmount.get(amount);
    selectedProduct = selectedButton?.dataset.productName || "Donation";
    amountButtons.forEach((button) => renderAmountButton(button, button === selectedButton));
    try {
      sessionStorage.setItem("cloudyDonationAmount", String(amount));
      sessionStorage.setItem("cloudyDonationProduct", selectedProduct);
    } catch {}
    updateTotal(announce);
  };

  amountButtons.forEach((button) => {
    button.addEventListener("click", () => selectAmount(amountFrom(button)));
  });

  addOn?.addEventListener("click", () => {
    hasAddOn = !hasAddOn;
    addOn.setAttribute("aria-checked", String(hasAddOn));
    addOn.classList.toggle("border-primary", hasAddOn);
    addOn.classList.toggle("bg-primary-soft/60", hasAddOn);
    addOn.classList.toggle("border-transparent", !hasAddOn);
    addOn.classList.toggle("bg-[#f2f4f6]", !hasAddOn);
    const track = addOn.querySelector("span[aria-hidden]");
    track?.classList.toggle("bg-primary", hasAddOn);
    track?.classList.toggle("bg-slate-300", !hasAddOn);
    const thumb = track?.querySelector("span");
    if (thumb) thumb.style.transform = hasAddOn ? "translateX(16px)" : "translateX(0)";
    try { sessionStorage.setItem("cloudyMedicineSupport", String(hasAddOn)); } catch {}
    updateTotal();
  });

  let storedAmount = selectedAmount;
  try {
    storedAmount = Number(sessionStorage.getItem("cloudyDonationAmount")) || selectedAmount;
    hasAddOn = sessionStorage.getItem("cloudyMedicineSupport") === "true";
  } catch {}
  selectAmount(buttonsByAmount.has(storedAmount) ? storedAmount : selectedAmount, false);

  if (addOn) {
    addOn.setAttribute("aria-checked", String(hasAddOn));
    addOn.classList.toggle("border-primary", hasAddOn);
    addOn.classList.toggle("bg-primary-soft/60", hasAddOn);
    addOn.classList.toggle("border-transparent", !hasAddOn);
    addOn.classList.toggle("bg-[#f2f4f6]", !hasAddOn);
    const track = addOn.querySelector("span[aria-hidden]");
    track?.classList.toggle("bg-primary", hasAddOn);
    track?.classList.toggle("bg-slate-300", !hasAddOn);
    const thumb = track?.querySelector("span");
    if (thumb) thumb.style.transform = hasAddOn ? "translateX(16px)" : "translateX(0)";
  }
  updateTotal(false);
})();

(() => {
  const heading = Array.from(document.querySelectorAll("h2")).find(
    (element) => element.textContent.trim() === "Frequently Asked Questions"
  );
  const section = heading?.closest("section");
  const questions = Array.from(section?.querySelectorAll("button[aria-expanded]") || []);
  if (!questions.length) return;

  const renderQuestion = (button, expanded) => {
    const panel = button.nextElementSibling;
    const icon = button.querySelector("svg");
    button.setAttribute("aria-expanded", String(expanded));
    if (panel) {
      panel.classList.toggle("mt-2", expanded);
      panel.classList.toggle("grid-rows-[1fr]", expanded);
      panel.classList.toggle("opacity-100", expanded);
      panel.classList.toggle("grid-rows-[0fr]", !expanded);
      panel.classList.toggle("opacity-0", !expanded);
      panel.setAttribute("aria-hidden", String(!expanded));
    }
    if (icon) {
      icon.innerHTML = expanded
        ? '<path d="M5 12h14"></path>'
        : '<path d="M5 12h14"></path><path d="M12 5v14"></path>';
    }
  };

  questions.forEach((button, index) => {
    const panel = button.nextElementSibling;
    const panelId = `faq-answer-${index + 1}`;
    if (panel) panel.id = panelId;
    button.setAttribute("aria-controls", panelId);
    button.addEventListener("click", () => {
      const shouldOpen = button.getAttribute("aria-expanded") !== "true";
      questions.forEach((question) => renderQuestion(question, question === button && shouldOpen));
    });
  });

  questions.forEach((button) => renderQuestion(button, button.getAttribute("aria-expanded") === "true"));
})();

(() => {
  const floatingBar = Array.from(document.querySelectorAll("div.fixed.inset-x-0.bottom-0")).find(
    (element) => element.textContent.includes("Donate now")
  );
  const floatingButton = floatingBar?.querySelector("button");
  const mainDonateButton = Array.from(document.querySelectorAll("button")).find((button) =>
    /Donate \$\d/.test(button.textContent)
  );
  const donationSection = mainDonateButton?.closest("section") || mainDonateButton?.parentElement;
  if (!floatingBar || !floatingButton || !mainDonateButton || !donationSection) return;

  let pastDonationSection = false;
  let ticking = false;

  const renderVisibility = () => {
    floatingBar.classList.toggle("translate-y-full", !pastDonationSection);
    floatingBar.style.translate = pastDonationSection ? "0 0" : "0 100%";
    floatingBar.style.opacity = pastDonationSection ? "1" : "0";
    floatingBar.classList.toggle("pointer-events-none", !pastDonationSection);
    floatingBar.setAttribute("aria-hidden", String(!pastDonationSection));
    floatingButton.classList.toggle("pointer-events-none", !pastDonationSection);
    floatingButton.tabIndex = pastDonationSection ? 0 : -1;
  };

  const updateVisibility = () => {
    const sectionBottom = donationSection.getBoundingClientRect().bottom;
    pastDonationSection = sectionBottom < 72;
    renderVisibility();
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateVisibility);
  }, { passive: true });
  window.addEventListener("resize", updateVisibility, { passive: true });

  floatingButton.addEventListener("click", () => {
    donationSection.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start"
    });
  });

  window.addEventListener("cloudy:donation-selection", (event) => {
    const total = event.detail?.total;
    if (total) floatingButton.setAttribute("aria-label", `Donate now. $${total} selected. Return to donation options.`);
  });

  updateVisibility();
})();

(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const readStoryButton = buttons.find((button) => button.textContent.trim() === "Read her story");
  const donateHeroButton = buttons.find((button) => button.textContent.trim() === "Donate to help her");
  const storySection = document.querySelector("#organizer-story");
  const donationSection = document.querySelector("#tier-list");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const scrollToSection = (section) => {
    if (!section) return;
    section.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    section.setAttribute("tabindex", "-1");
    section.focus({ preventScroll: true });
  };

  if (readStoryButton && storySection) {
    readStoryButton.setAttribute("aria-controls", storySection.id);
    storySection.setAttribute("aria-label", "Jessica's story");
    readStoryButton.addEventListener("click", () => scrollToSection(storySection));
  }

  if (donateHeroButton && donationSection) {
    donateHeroButton.setAttribute("aria-controls", donationSection.id);
    donateHeroButton.addEventListener("click", () => {
      donationSection.classList.remove("lg:hidden");
      scrollToSection(donationSection);
    });
  }
})();

(() => {
  const placeholderTitle = Array.from(document.querySelectorAll("div")).find(
    (element) => element.textContent.trim() === "Standing with Jessica"
  );
  const hero = placeholderTitle?.parentElement?.parentElement;
  if (!hero) return;

  const image = document.createElement("img");
  let campaignPhoto = "/assets/jessica-family.png";
  try {
    campaignPhoto = JSON.parse(localStorage.getItem("cloudyCampaignData") || "null")?.photo || campaignPhoto;
  } catch {}
  image.src = campaignPhoto;
  image.alt = "Jessica seated outdoors beside a family member";
  image.loading = "eager";
  image.fetchPriority = "high";
  image.decoding = "async";
  image.style.width = "100%";
  image.style.height = "100%";
  image.style.objectFit = "cover";
  image.style.objectPosition = "center center";
  image.style.display = "block";

  hero.replaceChildren(image);
  hero.style.display = "block";
  hero.style.overflow = "hidden";
})();

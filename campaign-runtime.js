(() => {
  const store = window.CloudyCampaignStore;
  if (!store) return;
  const data = store.load();
  const leafElements = (root = document.body) => Array.from(root.querySelectorAll("h1,h2,h3,p,span,strong,div")).filter((element) => !element.children.length);
  const setLeafMatching = (pattern, value, root = document.body) => {
    leafElements(root).filter((element) => pattern.test(element.textContent.trim())).forEach((element) => { element.textContent = value; });
  };
  const money = (value) => `$${Number(value || 0).toLocaleString("en-US")}`;

  const title = document.querySelector("h1");
  if (title) title.textContent = data.title;

  const titleRegion = title?.parentElement;
  const intro = Array.from(titleRegion?.querySelectorAll("p") || []).find((paragraph) => paragraph.textContent.trim().length > 45);
  if (intro) intro.textContent = data.intro;

  setLeafMatching(/^Urgent appeal$/i, data.status || "Urgent appeal");
  setLeafMatching(/^Goal \$[\d,.]+$/i, `Goal ${money(data.goal)}`);
  const donationRegion = document.querySelector("#tier-list");
  const raisedValue = Array.from(donationRegion?.querySelectorAll("span") || []).find((element) =>
    /^\$[\d,.]+\s*$/.test(element.firstChild?.textContent || "") && /raised/i.test(element.textContent)
  );
  if (raisedValue?.firstChild) raisedValue.firstChild.textContent = `${money(data.raised)} `;
  const goalValue = leafElements(donationRegion || document.body).find((element) => /^of \$[\d,.]+$/i.test(element.textContent.trim()));
  if (goalValue) goalValue.textContent = `of ${money(data.goal)}`;
  const progress = donationRegion?.querySelector(".progress-anim");
  if (progress) progress.style.width = `${Math.min(100, Math.max(0, (Number(data.raised) / Math.max(Number(data.goal), 1)) * 100))}%`;

  const storySection = document.querySelector("#organizer-story");
  const storyContainer = storySection?.querySelector(".mt-4.space-y-3") || storySection?.querySelector("div:has(> p)");
  if (storyContainer && data.story) {
    const paragraphs = data.story.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    storyContainer.replaceChildren(...paragraphs.map((paragraph) => {
      const element = document.createElement("p");
      element.textContent = paragraph;
      return element;
    }));
  }
  const organizerHeader = storySection?.firstElementChild;
  const organizerText = organizerHeader?.lastElementChild;
  if (organizerText && data.organizerName) {
    organizerText.children[0].textContent = data.organizerName;
    const avatar = organizerHeader.firstElementChild;
    if (avatar) avatar.textContent = data.organizerName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    setLeafMatching(/^Organised by .+$/i, `Organised by ${data.organizerName}`, document.querySelector("#tier-list") || document.body);
  }
  if (organizerText && data.organizerRole) {
    organizerText.children[1].textContent = data.organizerRole;
  }

  const tierButtons = Array.from(document.querySelectorAll("#tier-list button[aria-pressed]")).slice(0, data.tiers.length);
  const badgeWords = /^(RECOMMENDED|URGENT SUPPORT|MAX IMPACT)$/i;
  const badgeTemplate = leafElements(document.querySelector("#tier-list") || document.body).find((element) => badgeWords.test(element.textContent.trim()));
  tierButtons.forEach((button, index) => {
    const tier = data.tiers[index];
    if (!tier) return;
    const leaves = leafElements(button);
    const amount = leaves.find((element) => /^\$[\d,.]+$/.test(element.textContent.trim()));
    const detail = button.querySelector("div.grid");
    const description = detail ? leafElements(detail).find((element) => element.textContent.trim()) : null;
    const titleElement = leaves.find((element) => {
      const text = element.textContent.trim();
      return text && element !== amount && element !== description && !badgeWords.test(text) && !/^\$/.test(text);
    });
    if (amount) amount.textContent = money(tier.amount);
    if (titleElement) titleElement.textContent = tier.title;
    if (description) description.textContent = tier.description;
    const currentBadge = leaves.find((element) => badgeWords.test(element.textContent.trim()));
    if (!tier.badge) currentBadge?.remove();
    else if (currentBadge) currentBadge.textContent = tier.badge;
    else if (badgeTemplate) {
      const badge = badgeTemplate.cloneNode(true);
      badge.textContent = tier.badge;
      button.append(badge);
    }
  });

  const faqHeading = Array.from(document.querySelectorAll("h2")).find((element) => element.textContent.trim() === "Frequently Asked Questions");
  const faqSection = faqHeading?.closest("section");
  const faqButtons = Array.from(faqSection?.querySelectorAll("button[aria-expanded]") || []);
  const faqItemTemplate = faqButtons[0]?.parentElement;
  const faqList = faqItemTemplate?.parentElement;
  if (faqList && faqItemTemplate && data.faqs?.length) {
    const items = data.faqs.map((faq, index) => {
      const item = faqItemTemplate.cloneNode(true);
      const button = item.querySelector("button[aria-expanded]");
      const textTarget = button ? leafElements(button).find((element) => element.textContent.trim() && element.tagName !== "PATH") : null;
      if (textTarget) textTarget.textContent = faq.question;
      else if (button) button.insertAdjacentText("afterbegin", faq.question);
      button?.setAttribute("aria-expanded", String(index === 0));
      const panel = button?.nextElementSibling;
      const answer = panel ? leafElements(panel).find((element) => element.textContent.trim()) : null;
      if (answer) answer.textContent = faq.answer;
      return item;
    });
    faqList.replaceChildren(...items);
  }

  const messagesHeading = Array.from(document.querySelectorAll("h2")).find((element) => /Words of support/i.test(element.textContent));
  const messagesSection = messagesHeading?.closest("section");
  const messageCards = Array.from(messagesSection?.querySelectorAll("article") || []);
  if (messageCards.length && data.messages?.length) {
    const list = messageCards[0].parentElement;
    const cards = data.messages.map((message) => {
      const card = messageCards[0].cloneNode(true);
      const identity = card.firstElementChild;
      const avatar = identity?.firstElementChild;
      const meta = identity?.lastElementChild;
      const name = meta?.children[0];
      const amountAndDate = meta?.children[1];
      const quote = card.querySelector("p");
      if (avatar) avatar.textContent = (message.name || "Anonymous").trim()[0]?.toUpperCase() || "A";
      if (name) name.textContent = message.name;
      if (amountAndDate) amountAndDate.textContent = `${money(message.amount)} · ${message.date}`;
      if (quote) quote.textContent = message.message;
      return card;
    });
    list.replaceChildren(...cards);
  }
  const messageCount = messagesHeading?.parentElement?.querySelector("span");
  if (messageCount) messageCount.textContent = String(data.messages?.length || 0);
})();

(() => {
  const validAmount = (value) => Number.isFinite(value) && value > 0 && value <= 100000;
  const params = new URLSearchParams(window.location.search);
  let amount = Number(params.get("amount"));
  let medicineSupport = params.get("medicine") === "1";

  try {
    if (!validAmount(amount)) amount = Number(sessionStorage.getItem("cloudyDonationAmount"));
    if (!params.has("medicine")) medicineSupport = sessionStorage.getItem("cloudyMedicineSupport") === "true";
  } catch {}
  if (!validAmount(amount)) amount = 50;

  const total = amount + (medicineSupport ? 15 : 0);
  const money = (value) => `$${value.toLocaleString("en-US")}`;
  document.querySelector("#donation-amount").textContent = money(amount);
  document.querySelector("#medicine-line").hidden = !medicineSupport;
  document.querySelector("#summary-total").textContent = money(total);
  document.querySelector("#submit-total").textContent = money(total);

  const form = document.querySelector("#checkout-form");
  const message = document.querySelector("#checkout-message");
  const submitButton = form.querySelector(".submit-button");
  const submitLabel = submitButton.querySelector("span");
  const paymentElement = document.querySelector("#payment-element");
  const requestId = crypto.randomUUID();
  let stripe = null;
  let elements = null;
  const fields = [
    { input: document.querySelector("#email"), error: document.querySelector("#email-error"), message: "Enter a valid email address." },
    { input: document.querySelector("#first-name"), error: document.querySelector("#first-name-error"), message: "Enter your first name." },
    { input: document.querySelector("#last-name"), error: document.querySelector("#last-name-error"), message: "Enter your last name." },
    { input: document.querySelector("#country"), error: document.querySelector("#country-error"), message: "Select your country or region." }
  ];

  const validateField = ({ input, error, message: errorMessage }) => {
    const valid = input.checkValidity();
    input.setAttribute("aria-invalid", String(!valid));
    input.setAttribute("aria-describedby", error.id);
    error.textContent = valid ? "" : errorMessage;
    return valid;
  };

  fields.forEach((field) => {
    field.input.addEventListener("blur", () => validateField(field));
    field.input.addEventListener("input", () => {
      if (field.input.getAttribute("aria-invalid") === "true") validateField(field);
    });
  });

  const showMessage = (text) => {
    message.textContent = text;
    message.hidden = false;
    message.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    const fieldsValid = fields.map(validateField).every(Boolean);
    const terms = document.querySelector("#terms");
    const termsError = document.querySelector("#terms-error");
    termsError.textContent = terms.checked ? "" : "Confirm that you understand this is a donation.";

    if (!fieldsValid || !terms.checked) {
      const firstInvalid = form.querySelector('[aria-invalid="true"], #terms:not(:checked)');
      firstInvalid?.focus();
      return;
    }

    submitButton.disabled = true;
    if (!elements) {
      submitLabel.textContent = "Connecting securely…";
      try {
        const response = await fetch("/api/navenaut/create-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(total * 100),
            email: document.querySelector("#email").value.trim(),
            name: `${document.querySelector("#first-name").value.trim()} ${document.querySelector("#last-name").value.trim()}`.trim(),
            requestId
          })
        });
        const payment = await response.json();
        if (!response.ok) throw new Error(payment.error || "Unable to start the payment.");
        if (typeof window.Stripe !== "function") throw new Error("The secure payment form could not be loaded.");

        stripe = window.Stripe(payment.publishableKey);
        elements = stripe.elements({ clientSecret: payment.clientSecret });
        paymentElement.replaceChildren();
        paymentElement.classList.add("is-connected");
        elements.create("payment").mount(paymentElement);
        submitLabel.textContent = "Confirm donation";
        showMessage("The secure card form is ready. Review the payment details and confirm your donation.");
      } catch (error) {
        submitLabel.textContent = "Continue securely";
        showMessage(error.message || "Unable to connect to Navenaut. Please try again.");
      } finally {
        submitButton.disabled = false;
      }
      return;
    }

    submitLabel.textContent = "Processing…";
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}/payment-status.html` },
        redirect: "if_required"
      });
      if (result.error) throw new Error(result.error.message || "Payment could not be completed.");
      window.location.assign("/payment-status.html");
    } catch (error) {
      showMessage(error.message || "Payment could not be completed.");
      submitLabel.textContent = "Confirm donation";
      submitButton.disabled = false;
    }
  });
})();

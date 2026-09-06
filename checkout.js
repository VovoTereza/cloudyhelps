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

  form.addEventListener("submit", (event) => {
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

    message.innerHTML = "<strong>Payment processor not connected.</strong><br>No charge was made. Connect Stripe Elements and a server-side PaymentIntent endpoint to enable live donations.";
    message.hidden = false;
    message.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  });
})();

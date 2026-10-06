(() => {
  const form = document.querySelector("#auth-form");
  const title = document.querySelector("#auth-title");
  const lead = document.querySelector("#auth-lead");
  const email = document.querySelector("#admin-email");
  const password = document.querySelector("#admin-password");
  const confirmField = document.querySelector("#confirm-field");
  const submit = document.querySelector("#auth-submit");
  const message = document.querySelector("#auth-message");

  title.textContent = "Admin access";
  lead.textContent = "Sign in with your authorized Cloudy Impact account.";
  confirmField.hidden = true;
  document.querySelector("#admin-confirm").required = false;
  submit.textContent = "Sign in";

  window.CloudySupabase.auth.getSession().then((session) => {
    if (session) window.location.replace("/admin.html");
  });

  const setError = (input, text) => {
    document.querySelector(`#${input.id.replace("admin-", "")}-error`).textContent = text;
    input.setAttribute("aria-invalid", String(Boolean(text)));
  };

  document.querySelector("#toggle-password").addEventListener("click", (event) => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    event.currentTarget.setAttribute("aria-label", visible ? "Show password" : "Hide password");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    setError(email, email.validity.valid ? "" : "Enter a valid email address.");
    setError(password, password.value.length >= 10 ? "" : "Use at least 10 characters.");
    if (!email.validity.valid || password.value.length < 10) return;

    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      await window.CloudySupabase.auth.signIn(email.value.trim().toLowerCase(), password.value);
      window.location.replace("/admin.html");
    } catch (error) {
      message.textContent = error.message || "Unable to sign in.";
      message.hidden = false;
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });
})();

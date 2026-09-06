(() => {
  const credentialKey = "cloudyAdminCredentials";
  const sessionKey = "cloudyAdminSession";
  const encoder = new TextEncoder();
  const form = document.querySelector("#auth-form");
  const title = document.querySelector("#auth-title");
  const lead = document.querySelector("#auth-lead");
  const email = document.querySelector("#admin-email");
  const password = document.querySelector("#admin-password");
  const confirmField = document.querySelector("#confirm-field");
  const confirm = document.querySelector("#admin-confirm");
  const submit = document.querySelector("#auth-submit");
  const message = document.querySelector("#auth-message");
  let credentials = null;

  try { credentials = JSON.parse(localStorage.getItem(credentialKey) || "null"); } catch {}
  const setupMode = !credentials?.email || !credentials?.salt || !credentials?.hash;

  if (sessionStorage.getItem(sessionKey) === "active") {
    window.location.replace("/admin.html");
    return;
  }

  if (setupMode) {
    title.textContent = "Create admin access";
    lead.textContent = "Set the local credentials for this campaign preview.";
    confirmField.hidden = false;
    confirm.required = true;
    password.autocomplete = "new-password";
    submit.textContent = "Create access";
  } else {
    email.value = credentials.email;
  }

  const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const base64ToBytes = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

  const deriveHash = async (value, salt) => {
    const key = await crypto.subtle.importKey("raw", encoder.encode(value), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 180000, hash: "SHA-256" },
      key,
      256
    );
    return bytesToBase64(bits);
  };

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
    if (setupMode) setError(confirm, confirm.value === password.value ? "" : "Passwords do not match.");
    if (!email.validity.valid || password.value.length < 10 || (setupMode && confirm.value !== password.value)) return;

    submit.disabled = true;
    submit.textContent = setupMode ? "Creating access…" : "Signing in…";
    try {
      if (setupMode) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const record = { email: email.value.trim().toLowerCase(), salt: bytesToBase64(salt), hash: await deriveHash(password.value, salt) };
        localStorage.setItem(credentialKey, JSON.stringify(record));
      } else {
        const emailMatches = email.value.trim().toLowerCase() === credentials.email;
        const hash = await deriveHash(password.value, base64ToBytes(credentials.salt));
        if (!emailMatches || hash !== credentials.hash) throw new Error("Incorrect email or password.");
      }
      sessionStorage.setItem(sessionKey, "active");
      window.location.replace("/admin.html");
    } catch (error) {
      message.textContent = error.message || "Unable to sign in.";
      message.hidden = false;
      submit.disabled = false;
      submit.textContent = setupMode ? "Create access" : "Sign in";
    }
  });
})();

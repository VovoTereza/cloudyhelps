(() => {
  const form = document.querySelector("#auth-form");
  const title = document.querySelector("#auth-title");
  const lead = document.querySelector("#auth-lead");
  const email = document.querySelector("#admin-email");
  const password = document.querySelector("#admin-password");
  const submit = document.querySelector("#auth-submit");
  const message = document.querySelector("#auth-message");

  title.textContent = "Acesso administrativo";
  lead.textContent = "Entre com sua conta autorizada da Cloudy Impact.";
  submit.textContent = "Entrar";

  window.CloudySupabase.auth.getSession().then(async (session) => {
    if (session && await window.CloudySupabase.auth.isAdmin(session)) {
      window.location.replace("/admin.html");
    }
  });

  const setError = (input, text) => {
    document.querySelector(`#${input.id.replace("admin-", "")}-error`).textContent = text;
    input.setAttribute("aria-invalid", String(Boolean(text)));
  };

  document.querySelector("#toggle-password").addEventListener("click", (event) => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    event.currentTarget.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    setError(email, email.validity.valid ? "" : "Digite um endereço de e-mail válido.");
    setError(password, password.value.length >= 10 ? "" : "Use pelo menos 10 caracteres.");
    if (!email.validity.valid || password.value.length < 10) return;

    submit.disabled = true;
    submit.textContent = "Entrando…";
    try {
      const session = await window.CloudySupabase.auth.signIn(email.value.trim().toLowerCase(), password.value);
      if (!await window.CloudySupabase.auth.isAdmin(session)) {
        await window.CloudySupabase.auth.signOut();
        throw new Error("unauthorized_admin");
      }
      window.location.replace("/admin.html");
    } catch (error) {
      const invalidCredentials = /invalid login credentials/i.test(error.message || "");
      const unauthorizedAdmin = error.message === "unauthorized_admin";
      message.textContent = invalidCredentials
        ? "E-mail ou senha incorretos."
        : unauthorizedAdmin
          ? "Esta conta não tem permissão para acessar o painel."
          : "Não foi possível entrar. Tente novamente.";
      message.hidden = false;
      submit.disabled = false;
      submit.textContent = "Entrar";
    }
  });
})();

const API_BASE =
  window.location.hostname === "localhost"
    ? "http://localhost:3005/api"
    : "/api";

"use strict";

let resetBusy = false;
let responseSucceeded = false;

function showResetMessage(message, isError = false) {
  const box = document.getElementById("authMessage");

  if (!box) return;

  box.textContent = message;
  box.style.color = isError ? "#ffb4b4" : "#ffd86b";
}

async function submitPasswordReset() {
  if (resetBusy) return;

  const token = new URLSearchParams(
    window.location.search
  ).get("token");

  const newPassword =
    document.getElementById("newPassword")?.value || "";

  const confirmPassword =
    document.getElementById("confirmPassword")?.value || "";

  if (!token) {
    showResetMessage(
      "Link de recuperação inválido ou incompleto.",
      true
    );
    return;
  }

  if (newPassword.length < 6) {
    showResetMessage(
      "A nova senha deve ter pelo menos 6 caracteres.",
      true
    );
    return;
  }

  if (newPassword !== confirmPassword) {
    showResetMessage(
      "As senhas informadas não são iguais.",
      true
    );
    return;
  }

  const btn = document.getElementById("btnResetPassword");

  resetBusy = true;

  if (btn) btn.disabled = true;

  showResetMessage("Redefinindo sua senha...");

  try {
    const response = await fetch(
      `${API_BASE}/auth/reset-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          newPassword
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showResetMessage(
        data.message ||
        "Não foi possível redefinir sua senha.",
        true
      );
      return;
    }

    responseSucceeded = true;

    showResetMessage(
      "Senha redefinida com sucesso! Você já pode acessar sua conta."
    );

    document.getElementById("newPassword").value = "";
    document.getElementById("confirmPassword").value = "";

    if (btn) btn.disabled = true;

  } catch (err) {
    console.error("[RESET PASSWORD] Erro:", err);

    showResetMessage(
      "Erro de conexão com o servidor. Tente novamente.",
      true
    );

  } finally {
    resetBusy = false;

    if (btn && !responseSucceeded) {
      btn.disabled = false;
    }
  }
}

document.getElementById("btnResetPassword")
  ?.addEventListener("click", submitPasswordReset);

document.getElementById("confirmPassword")
  ?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submitPasswordReset();
    }
  });


/* =========================================================
   CACHETA PLAY — RECUPERAÇÃO DE SENHA
========================================================= */

let recoveryBusy = false;

function showRecoveryMessage(message, isError = false) {
  const box = document.getElementById("authMessage");
  if (!box) return;

  box.textContent = message;
  box.style.color = isError ? "#ffb4b4" : "#ffd86b";
}


async function requestPasswordRecovery() {
  if (recoveryBusy) return;

  const email =
    document.getElementById("recoveryEmail")?.value?.trim() || "";

  if (!email) {
    showRecoveryMessage("Informe seu e-mail.", true);
    return;
  }

  const btn = document.getElementById("btnRecoverySubmit");

  recoveryBusy = true;
  if (btn) btn.disabled = true;

  showRecoveryMessage("Enviando solicitação de recuperação...");

  try {
    const response = await fetch(
      "http://localhost:3005/api/auth/forgot-password",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      showRecoveryMessage(
        data.message || "Não foi possível enviar a solicitação.",
        true
      );
      return;
    }

    showRecoveryMessage(
      data.message ||
      "Solicitação recebida! Confira sua caixa de e-mail."
    );

  } catch (err) {
    console.error("[RECOVERY] Erro:", err);

    showRecoveryMessage(
      "Erro de conexão com o servidor. Tente novamente.",
      true
    );

  } finally {
    recoveryBusy = false;
    if (btn) btn.disabled = false;
  }
}


document.getElementById("btnRecoverySubmit")
  ?.addEventListener("click", requestPasswordRecovery);

document.getElementById("recoveryEmail")
  ?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      requestPasswordRecovery();
    }
  });

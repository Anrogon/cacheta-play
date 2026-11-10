
const { MercadoPagoConfig, Payment } = require("mercadopago");
const https = require("node:https");

const accessToken = process.env.MP_ACCESS_TOKEN;

if (!accessToken) {
  console.warn("[MP] MP_ACCESS_TOKEN não configurado.");
}

const client = new MercadoPagoConfig({
  accessToken,
});

const payment = new Payment(client);

// =====================================================
// API DE PAGAMENTOS — MANTIDA TEMPORARIAMENTE
// =====================================================

async function createPixPayment({
  amountCents,
  description,
  payerEmail,
  externalReference
}) {
  const amount = Number(amountCents) / 100;

  const result = await payment.create({
    body: {
      transaction_amount: amount,
      description,
      payment_method_id: "pix",
      payer: {
        email: payerEmail,
      },
      external_reference: String(externalReference),
    },
  });

  return result;
}

async function getPaymentById(paymentId) {
  return await payment.get({
    id: String(paymentId),
  });
}

// =====================================================
// API DE ORDERS — NOVA INTEGRAÇÃO
// =====================================================

function requestOrder(method, path, body, idempotencyKey) {
  if (!accessToken) {
    throw new Error("MP_ACCESS_TOKEN não configurado.");
  }

  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }

    if (idempotencyKey) {
      headers["X-Idempotency-Key"] = String(idempotencyKey);
    }

    const req = https.request(
      {
        hostname: "api.mercadopago.com",
        path,
        method,
        headers,
        timeout: 15000,
      },
      (res) => {
        let responseText = "";

        res.setEncoding("utf8");

        res.on("data", (chunk) => {
          responseText += chunk;
        });

        res.on("end", () => {
          let result;

          try {
            result = JSON.parse(responseText);
          } catch (_) {
            return reject(
              new Error("Resposta inválida do Mercado Pago.")
            );
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              `Erro na API Orders: HTTP ${res.statusCode}`
            );

            error.status = res.statusCode;
            error.details = result;

            return reject(error);
          }

          resolve(result);
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("Tempo limite na API Orders."));
    });

    req.on("error", reject);

    if (payload !== null) {
      req.write(payload);
    }

    req.end();
  });
}

async function createPixOrder({
  amountCents,
  description,
  payerEmail,
  externalReference
}) {
  const cents = Number(amountCents);
  const reference = String(externalReference || "").trim();
  const email = String(payerEmail || "").trim();

  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("Valor do Pix inválido.");
  }

  if (!reference || reference.length > 64) {
    throw new Error("Referência da transação inválida.");
  }

  if (!email || !email.includes("@")) {
    throw new Error("E-mail do pagador inválido.");
  }

  const amount = (cents / 100).toFixed(2);

  const body = {
    type: "online",
    total_amount: amount,
    external_reference: reference,
    processing_mode: "automatic",
    transactions: {
      payments: [
        {
          amount,
          payment_method: {
            id: "pix",
            type: "bank_transfer",
          },
        },
      ],
    },
    payer: {
      email,
    },
  };

  // A referência da transação é estável entre tentativas.
  // Isso evita criar cobranças duplicadas no reenvio.
  const idempotencyKey = `cacheta-pix-${reference}`;

  return await requestOrder(
    "POST",
    "/v1/orders",
    body,
    idempotencyKey
  );
}

async function getOrderById(orderId) {
  const id = String(orderId || "").trim();

  if (!id) {
    throw new Error("ID da Order não informado.");
  }

  return await requestOrder(
    "GET",
    `/v1/orders/${encodeURIComponent(id)}`
  );
}

module.exports = {
  createPixPayment,
  getPaymentById,
  createPixOrder,
  getOrderById,
};

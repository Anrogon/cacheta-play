
"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

// Validade do link de recuperação: 30 minutos.
const TOKEN_EXPIRATION_MINUTES = 30;

// Gera um token seguro.
// Somente o hash será armazenado no banco.
function generatePasswordResetToken() {
  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  return { token, tokenHash };
}

// Cria um token de recuperação para o usuário.
// Invalida tokens anteriores do mesmo usuário.
async function createPasswordResetToken(userId) {
  const { token, tokenHash } = generatePasswordResetToken();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1`,
      [userId]
    );

    await client.query(
      `INSERT INTO password_reset_tokens
         (user_id, token_hash, expires_at)
       VALUES
         ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [userId, tokenHash]
    );

    await client.query("COMMIT");

    return token;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Valida o token e redefine a senha.
// A atualização e o consumo do token são atômicos.
async function resetPasswordWithToken(token, newPassword) {
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/i.test(token)
  ) {
    return { success: false, reason: "invalid" };
  }

  if (
    typeof newPassword !== "string" ||
    newPassword.length < 6
  ) {
    return { success: false, reason: "invalid_password" };
  }

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND expires_at > NOW()
       FOR UPDATE`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,
        reason: "invalid_or_expired"
      };
    }

    const userId = result.rows[0].user_id;

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await client.query(
      `UPDATE users
       SET password_hash = $1,
           session_version = COALESCE(session_version, 0) + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );

    await client.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    return { success: true, userId };

  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  createPasswordResetToken,
  resetPasswordWithToken
};

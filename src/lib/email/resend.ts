type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendTransactionalEmail(input: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Adstart W3 <no-reply@w3educacao.com.br>";

  // E-mail transacional é OPCIONAL nesta versão interna (single-tenant, ≤30
  // usuários geridos pelo admin). Sem RESEND_API_KEY o envio simplesmente é
  // pulado — o token de reset/convite ainda é criado no banco para uso manual.
  if (!apiKey) {
    return { skipped: true };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!response.ok) {
    throw new Error("Nao conseguimos enviar o email transacional agora.");
  }

  return { skipped: false };
}

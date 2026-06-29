type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

export async function sendTransactionalEmail(input: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "Adstart W3 <no-reply@w3educacao.com.br>";

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is required in production.");
    }

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

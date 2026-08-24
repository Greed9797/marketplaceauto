import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

test("creates a categorized demand and persists the timer lifecycle", async ({
  page,
}, testInfo) => {
  const suffix = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-");
  const runId = Date.now().toString(36);
  const categoryName = `E2E Ads ${suffix} ${runId}`;
  const taskTitle = `Melhorar anúncios ${suffix} ${runId}`;

  await page.addInitScript(() => {
    window.localStorage.setItem("adstart_w3_cookie_consent", "accepted");
  });

  await page.goto("/demandas/configuracoes");
  await expect(page.getByRole("heading", { name: "Configurar demandas" })).toBeVisible();
  await page.getByLabel("Nome").fill(categoryName);
  await page.getByLabel("Meta (min)").fill("30");
  await page.getByRole("button", { name: "Adicionar categoria" }).click();
  await expect(page.getByText("Categoria criada.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(categoryName)).toBeVisible();

  await page.goto("/demandas");
  await expect(page.getByRole("heading", { name: "Kanban de demandas" })).toBeVisible();
  await page.getByRole("button", { name: "Nova demanda" }).click();
  const createForm = page.locator("form").filter({ has: page.getByLabel("Título") });
  await createForm.getByLabel("Título").fill(taskTitle);
  await createForm.getByLabel("Categoria").selectOption({ label: `${categoryName} · meta 30 min` });
  await createForm.getByRole("button", { name: "Salvar demanda" }).click();
  await expect(page.getByText("Demanda cadastrada.")).toBeVisible({ timeout: 15_000 });

  let card = page.locator("article").filter({ hasText: taskTitle });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Iniciar" }).click();
  await expect(card.getByRole("button", { name: "Pausar" })).toBeVisible();
  await expect(card.locator(".font-mono")).not.toHaveText("00:00:00", { timeout: 5_000 });

  await card.getByRole("button", { name: "Pausar" }).click();
  await expect(card.getByRole("button", { name: "Retomar" })).toBeVisible();
  const pausedAt = await card.locator(".font-mono").textContent();
  await page.reload();
  card = page.locator("article").filter({ hasText: taskTitle });
  await expect(card.getByRole("button", { name: "Retomar" })).toBeVisible();
  await expect(card.locator(".font-mono")).toHaveText(pausedAt ?? "");

  await card.getByRole("button", { name: "Retomar" }).click();
  await expect(card.getByRole("button", { name: "Concluir" })).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "Concluir" }).click();
  await expect(card.getByText("Finalizada")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  card = page.locator("article").filter({ hasText: taskTitle });
  await expect(card.getByText("Finalizada")).toBeVisible();
  await page.getByRole("button", { name: "Abrir menu de navegação" }).click();
  await expect(page.getByRole("link", { name: "Demandas", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Conectores", exact: true })).toHaveCount(0);
});

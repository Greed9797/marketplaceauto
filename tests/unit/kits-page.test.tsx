import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KitsClient } from "@/app/(app)/kits/kits-client";

const fetchMock = vi.fn();

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function proposal(input: {
  id: string;
  status: string;
  clienteId?: string;
  clienteNome?: string;
}) {
  const clienteId = input.clienteId ?? "client-1";
  return {
    id: input.id,
    clienteId,
    cliente: { id: clienteId, nome: input.clienteNome ?? "Cliente 1" },
    componentIds: [`${input.id}-product-1`, `${input.id}-product-2`],
    components: [
      { id: `${input.id}-product-1`, name: "Camiseta azul", price: 50 },
      { id: `${input.id}-product-2`, name: "Camiseta branca", price: 60 },
    ],
    reason: "homogeneo: camiseta; giro indisponivel",
    monochromatic: false,
    status: input.status,
    suggestedPrice: 110,
    kit:
      input.status === "proposta"
        ? null
        : {
            id: `kit-${input.id}`,
            status: input.status,
            price: 109.9,
            produtoId: `derived-${input.id}`,
            categoryPending: true,
          },
  };
}

const review = {
  produtoId: "product-review",
  gender: "feminino",
  ageBand: "adulto",
  categoryKey: "vestido",
  colorPattern: "azul",
  confidence: 0.4,
  source: "ai",
  needsReview: true,
  produto: {
    id: "product-review",
    nomeOriginal: "Vestido azul",
    cliente: { id: "client-1", nome: "Cliente 1" },
  },
};

function mockApi(input: {
  proposals?: ReturnType<typeof proposal>[];
  classifications?: (typeof review)[];
}) {
  const proposals = input.proposals ?? [];
  const classifications = input.classifications ?? [];
  fetchMock.mockImplementation((request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    if (url === "/api/kits/proposals" && (!init?.method || init.method === "GET")) {
      return response({ success: true, data: { proposals } });
    }
    if (
      url === "/api/kits/classifications" &&
      (!init?.method || init.method === "GET")
    ) {
      return response({ success: true, data: { classifications } });
    }
    if (url === "/api/kits/proposals" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { action: string };
      if (body.action === "reject") {
        return response({
          success: true,
          data: { proposal: { id: "proposal-1", status: "rejeitada" } },
        });
      }
      return response({
        success: true,
        data: {
          kit: {
            id: "kit-proposal-1",
            status: "aprovado",
            price: 125,
            produtoId: "derived-proposal-1",
            categoryPending: true,
          },
        },
      });
    }
    if (url === "/api/kits/classifications" && init?.method === "PATCH") {
      return response({
        success: true,
        data: {
          classification: {
            ...review,
            categoryKey: "saia",
            source: "manual",
            confidence: 1,
            needsReview: false,
          },
        },
      });
    }
    if (url === "/api/kits/classify" && init?.method === "POST") {
      return response({
        success: true,
        data: { processed: 3, needsReview: 1, failures: 0 },
      });
    }
    return response({ success: false, error: "not mocked" }, 500);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("KitsClient", () => {
  it("renderiza proposta, aprovado e bloqueado (KIT-16)", async () => {
    mockApi({
      proposals: [
        proposal({ id: "proposal-1", status: "proposta" }),
        proposal({ id: "proposal-2", status: "aprovado" }),
        proposal({ id: "proposal-3", status: "bloqueado" }),
      ],
    });

    render(<KitsClient />);

    expect(
      await screen.findByText("Proposta", { selector: "span" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Aprovado", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Bloqueado", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText("Camiseta azul")).toHaveLength(3);
  });

  it("renderiza estado vazio", async () => {
    mockApi({});

    render(<KitsClient />);

    expect(await screen.findByText("Nenhum kit encontrado.")).toBeInTheDocument();
    expect(screen.getByText("Fila de revisão vazia.")).toBeInTheDocument();
  });

  it("liga o Kit aprovado ao editor do Produto derivado (KIT-13)", async () => {
    mockApi({ proposals: [proposal({ id: "proposal-1", status: "aprovado" })] });

    render(<KitsClient />);

    const link = await screen.findByRole("link", { name: "Revisar anúncio" });
    expect(link).toHaveAttribute(
      "href",
      "/produtos/derived-proposal-1/editar",
    );
    expect(screen.getByText("Categoria pendente")).toBeInTheDocument();
  });

  it("aprova com preco editado e mostra o Kit aprovado (KIT-13)", async () => {
    mockApi({ proposals: [proposal({ id: "proposal-1", status: "proposta" })] });

    render(<KitsClient />);

    const price = await screen.findByLabelText("Preço do kit proposal-1");
    fireEvent.change(price, { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" }));

    expect(
      await screen.findByText("Aprovado", { selector: "span" }),
    ).toBeInTheDocument();
    const decisionCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/kits/proposals" && init?.method === "PATCH",
    );
    expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({
      action: "approve",
      proposalId: "proposal-1",
      price: 125,
    });
  });

  it("filtra a lista por cliente e status (KIT-16)", async () => {
    mockApi({
      proposals: [
        proposal({ id: "proposal-1", status: "proposta" }),
        proposal({
          id: "proposal-2",
          status: "bloqueado",
          clienteId: "client-2",
          clienteNome: "Cliente 2",
        }),
      ],
    });

    render(<KitsClient />);

    await screen.findByText("Proposta", { selector: "span" });
    fireEvent.change(screen.getByLabelText("Filtrar por cliente"), {
      target: { value: "client-2" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por status"), {
      target: { value: "bloqueado" },
    });

    expect(screen.getByText("Cliente 2", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Bloqueado", { selector: "span" })).toBeInTheDocument();
    expect(
      screen.queryByText("Proposta", { selector: "span" }),
    ).not.toBeInTheDocument();
  });

  it("rejeita a proposta pela fila de revisao (KIT-14)", async () => {
    mockApi({ proposals: [proposal({ id: "proposal-1", status: "proposta" })] });

    render(<KitsClient />);

    const action = await screen.findByRole("button", { name: "Rejeitar" });
    fireEvent.click(action);

    expect(
      await screen.findByText("Rejeitado", { selector: "span" }),
    ).toBeInTheDocument();
    const decisionCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/kits/proposals" && init?.method === "PATCH",
    );
    expect(JSON.parse(String(decisionCall?.[1]?.body))).toEqual({
      action: "reject",
      proposalId: "proposal-1",
    });
  });

  it("salva revisao inline como manual e remove da fila (KIT-04)", async () => {
    mockApi({ classifications: [review] });

    render(<KitsClient />);

    const category = await screen.findByLabelText("Categoria product-review");
    fireEvent.change(category, { target: { value: "saia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar manualmente" }));

    expect(await screen.findByText("Fila de revisão vazia.")).toBeInTheDocument();
    const manualCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/kits/classifications" && init?.method === "PATCH",
    );
    expect(JSON.parse(String(manualCall?.[1]?.body))).toEqual({
      produtoId: "product-review",
      gender: "feminino",
      ageBand: "adulto",
      categoryKey: "saia",
      colorPattern: "azul",
    });
  });

  it("aciona classificacao em lote e mostra contadores (KIT-03, KIT-05)", async () => {
    mockApi({});

    render(<KitsClient />);

    const action = await screen.findByRole("button", {
      name: "Classificar pendentes",
    });
    fireEvent.click(action);

    expect(
      await screen.findByText("3 processados, 1 para revisão, 0 falhas."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/kits/classify",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

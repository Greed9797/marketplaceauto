import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders the provided label", () => {
    render(<Button>Conectar minha primeira conta</Button>);

    expect(screen.getByRole("button", { name: "Conectar minha primeira conta" })).toBeInTheDocument();
  });

  it("keeps secondary actions visually distinct from primary actions", () => {
    render(<Button variant="secondary">Cancelar</Button>);

    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveClass(
      "border-[var(--border-strong)]",
    );
  });

  it("can render a link when composed with asChild", () => {
    render(
      <Button asChild>
        <a href="/dashboard">Abrir dashboard</a>
      </Button>,
    );

    expect(screen.getByRole("link", { name: "Abrir dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

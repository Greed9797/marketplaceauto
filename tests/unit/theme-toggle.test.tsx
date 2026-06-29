import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeToggle } from "@/components/theme/theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("defaults to dark and persists light selection", () => {
    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Usar tema claro" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("adstart-w3-theme")).toBe("light");
  });

  it("restores a previously saved theme", () => {
    localStorage.setItem("adstart-w3-theme", "light");

    render(<ThemeToggle />);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(screen.getByRole("button", { name: "Usar tema claro" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

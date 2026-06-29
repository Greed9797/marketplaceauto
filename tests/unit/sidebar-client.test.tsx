import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarClient } from "@/components/layouts/sidebar-client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("SidebarClient", () => {
  it("renders nav items and logout in the drawer", () => {
    render(
      <SidebarClient
        currentRoleLabel="Owner"
        currentWorkspace={{ id: "workspace-1", name: "W3 Dev" }}
        logoutAction={async () => {}}
        navItems={[
          {
            href: "/dashboard",
            icon: "dashboard",
            label: "Dashboard",
            section: "overview",
          },
        ]}
        userEmail="owner@w3.dev"
        userImage={null}
        userName="W3 Owner"
      />,
    );

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(screen.getByText("W3 Dev")).toBeInTheDocument();
  });
});

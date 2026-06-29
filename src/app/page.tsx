import { redirect } from "next/navigation";

export default function Home() {
  // Marcas is the home/lobby — pick a brand there to open its dashboard.
  // Non-brand-viewers (clients) are bounced to /dashboard by the Marcas guard.
  redirect("/dashboards");
}

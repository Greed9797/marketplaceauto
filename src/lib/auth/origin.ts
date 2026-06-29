import { headers } from "next/headers";

export async function resolveAppOrigin(): Promise<string> {
  const envBase = process.env.NEXTAUTH_URL?.trim();
  if (envBase) return envBase.replace(/\/$/, "");

  const headerList = await headers();
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  return `${proto}://${host}`;
}

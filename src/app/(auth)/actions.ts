"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth/auth";
import {
  getAuthSessionCookieName,
  getLaxCookieOptions,
} from "@/lib/auth/cookies";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import {
  AuthServiceError,
  createDatabaseSessionForUser,
  getUserByCredentials,
  registerUserWithWorkspace,
  requestPasswordReset,
  resetPassword,
} from "@/lib/auth/service";

function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: getString(formData, "email"),
    password: getString(formData, "password"),
  });

  if (!parsed.success) {
    redirect("/login?error=invalid");
  }

  const user = await getUserByCredentials(
    parsed.data.email,
    parsed.data.password,
  );

  if (!user) {
    redirect("/login?error=credentials");
  }

  const session = await createDatabaseSessionForUser(user.id);
  const cookieStore = await cookies();

  cookieStore.set(getAuthSessionCookieName(), session.sessionToken, {
    // `lax`, NOT `strict`: a strict session cookie is dropped when an OAuth
    // provider redirects back to our connector callback (top-level cross-site
    // GET), causing an infinite /login loop. `lax` survives it and still blocks
    // cross-site POST/CSRF.
    ...getLaxCookieOptions({ expires: session.expires }),
  });

  redirect("/dashboard");
}

export async function googleSignInAction() {
  if (
    !process.env.GOOGLE_OAUTH_CLIENT_ID ||
    !process.env.GOOGLE_OAUTH_CLIENT_SECRET
  ) {
    redirect("/login?error=google-not-configured");
  }

  await signIn("google", { redirectTo: "/dashboard" });
}

export async function signUpAction(formData: FormData) {
  const inviteToken = getString(formData, "inviteToken") || undefined;
  const parsed = signUpSchema.safeParse({
    name: getString(formData, "name"),
    email: getString(formData, "email"),
    password: getString(formData, "password"),
    workspaceName: getString(formData, "workspaceName"),
    acceptedTerms: formData.get("acceptedTerms"),
    inviteToken,
  });

  if (!parsed.success) {
    redirect("/sign-up?error=invalid");
  }

  if (
    !parsed.data.inviteToken &&
    (process.env.NODE_ENV === "production" ||
      process.env.VERCEL_ENV === "production")
  ) {
    redirect("/login?error=signup-closed");
  }

  try {
    await registerUserWithWorkspace(parsed.data);
    const user = await getUserByCredentials(
      parsed.data.email,
      parsed.data.password,
    );

    if (!user) {
      redirect("/login?error=credentials");
    }

    const session = await createDatabaseSessionForUser(user.id);
    const cookieStore = await cookies();

    cookieStore.set(getAuthSessionCookieName(), session.sessionToken, {
      // `lax` (not `strict`) so the session survives the OAuth provider's
      // cross-site redirect back to our connector callback — see signInAction.
      ...getLaxCookieOptions({ expires: session.expires }),
    });

    redirect("/dashboard");
  } catch (error) {
    if (error instanceof AuthServiceError && error.code === "EMAIL_IN_USE") {
      redirect("/sign-up?error=email-in-use");
    }

    if (error instanceof AuthServiceError && error.code === "INVALID_TOKEN") {
      redirect("/sign-up?error=invalid");
    }

    if (error instanceof AuthError) {
      redirect("/login?error=credentials");
    }

    throw error;
  }
}

export async function forgotPasswordAction(formData: FormData) {
  const parsed = forgotPasswordSchema.safeParse({
    email: getString(formData, "email"),
  });

  if (parsed.success) {
    await requestPasswordReset(parsed.data);
  }

  redirect("/forgot-password?sent=1");
}

export async function resetPasswordAction(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse({
    token: getString(formData, "token"),
    password: getString(formData, "password"),
  });

  if (!parsed.success) {
    redirect("/reset-password?error=invalid");
  }

  try {
    await resetPassword(parsed.data);
  } catch (error) {
    if (error instanceof AuthServiceError) {
      redirect("/reset-password?error=invalid");
    }

    throw error;
  }

  redirect("/login?reset=1");
}

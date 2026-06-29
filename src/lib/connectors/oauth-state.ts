import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ConnectorOAuthProvider =
  | "META_ADS"
  | "GOOGLE_ADS"
  | "GA4"
  | "SHOPIFY"
  | "NUVEMSHOP"
  | "MERCADO_LIVRE"
  | "SHOPEE";

export type ConnectorOAuthStatePayload = {
  provider: ConnectorOAuthProvider;
  userId: string;
  workspaceId: string;
  nonce: string;
  issuedAt: number;
  shop?: string;
};

type CreateStateInput = Omit<ConnectorOAuthStatePayload, "issuedAt" | "nonce">;

type StateOptions = {
  secret?: string;
  now?: number;
  nonce?: string;
};

type VerifyOptions = {
  secret?: string;
  expectedProvider: ConnectorOAuthProvider;
  expectedUserId: string;
  /**
   * Optional. workspaceId is HMAC-signed into the state at init, so it is
   * already tamper-proof. Comparing it against a cookie-derived value in the
   * callback breaks legit flows when the workspace cookie is dropped on the
   * cross-site OAuth return. Prefer reading `payload.workspaceId` and
   * validating DB access. Only pass when a genuinely trusted expected
   * workspace is available (not the cookie).
   */
  expectedWorkspaceId?: string;
  expectedShop?: string;
  now?: number;
  maxAgeMs?: number;
};

const defaultMaxAgeMs = 10 * 60 * 1000;

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function getConnectorOAuthStateSecret(
  env: Record<string, string | undefined> = process.env,
) {
  const secret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET;

  if (!secret && env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET or NEXTAUTH_SECRET is required for connector OAuth state",
    );
  }

  return secret ?? "adstart-w3-local-oauth-state-secret";
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createConnectorOAuthState(
  input: CreateStateInput,
  options: StateOptions = {},
) {
  const secret = options.secret ?? getConnectorOAuthStateSecret();
  const payload: ConnectorOAuthStatePayload = {
    ...input,
    nonce: options.nonce ?? randomBytes(16).toString("hex"),
    issuedAt: options.now ?? Date.now(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function parseConnectorOAuthState(state: string) {
  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Invalid connector OAuth state");
  }

  return {
    encodedPayload,
    signature,
    payload: JSON.parse(
      base64UrlDecode(encodedPayload),
    ) as ConnectorOAuthStatePayload,
  };
}

export function verifyConnectorOAuthState(
  state: string,
  options: VerifyOptions,
) {
  try {
    const secret = options.secret ?? getConnectorOAuthStateSecret();
    const parsed = parseConnectorOAuthState(state);
    const expectedSignature = sign(parsed.encodedPayload, secret);

    if (!safeEqual(parsed.signature, expectedSignature)) {
      return { valid: false as const, reason: "bad-signature" as const };
    }

    const now = options.now ?? Date.now();
    const maxAgeMs = options.maxAgeMs ?? defaultMaxAgeMs;

    if (now - parsed.payload.issuedAt > maxAgeMs) {
      return { valid: false as const, reason: "expired" as const };
    }

    if (
      parsed.payload.provider !== options.expectedProvider ||
      parsed.payload.userId !== options.expectedUserId ||
      (options.expectedWorkspaceId !== undefined &&
        parsed.payload.workspaceId !== options.expectedWorkspaceId) ||
      (options.expectedShop && parsed.payload.shop !== options.expectedShop)
    ) {
      return { valid: false as const, reason: "context-mismatch" as const };
    }

    return { valid: true as const, payload: parsed.payload };
  } catch {
    return { valid: false as const, reason: "invalid-format" as const };
  }
}

export interface SignInLinkResponse {
  ok?: boolean;
  message?: string;
  error?: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function requestArgusSignInLink(
  fetchImpl: FetchLike,
  email: string,
  returnTo: string,
): Promise<string> {
  const response = await fetchImpl("/api/signin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), returnTo }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await response.json().catch(() => ({}))) as SignInLinkResponse;
  if (!response.ok) {
    throw new Error(body.message || "The sign-in link could not be sent.");
  }
  return body.message || "If this email is approved, a secure sign-in link is on its way.";
}

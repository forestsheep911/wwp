import type { AuthCheckResponse } from "@wwpdw/shared";

export interface AuthenticatedSessionEnvelope {
  auth: AuthCheckResponse;
  csrfToken?: string;
}

export function unwrapAuthenticatedSession(response: AuthenticatedSessionEnvelope) {
  return response.auth;
}

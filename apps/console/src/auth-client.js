import { createAuthClient } from "better-auth/react";

const configuredGateway = import.meta.env?.VITE_GATEWAY_URL || "";
const browserOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const gatewayBaseURL = configuredGateway || browserOrigin;

export const authClient = createAuthClient({
  baseURL: gatewayBaseURL,
  fetchOptions: { credentials: "include" },
});

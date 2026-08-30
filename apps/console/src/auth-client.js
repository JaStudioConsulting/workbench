import { createAuthClient } from "better-auth/react";

const baseURL = import.meta.env.VITE_GATEWAY_URL || window.location.origin;

export const authClient = createAuthClient({
  baseURL,
  fetchOptions: { credentials: "include" },
});

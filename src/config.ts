export function getApiUrl() {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured) return configured;
  if (import.meta.env.DEV) return "http://localhost:3737";
  throw new Error("VITE_API_URL is required for production Graze builds");
}

export const API_URL = getApiUrl();

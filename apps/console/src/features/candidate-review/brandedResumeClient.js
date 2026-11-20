import { gatewayBaseURL } from "../../auth-client.js";
import { supabase } from "../../supabase-client.js";

export const NO_RESUME_TEXT_MESSAGE = "There is no resume text to format. Add or paste the resume text first, then try again.";

const FORMAT_LABELS = { pdf: "PDF", docx: "Word" };

function fileNameFromHeader(header, fallback) {
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(header || "");
  if (encoded) {
    try { return decodeURIComponent(encoded[1]); } catch { /* fall through */ }
  }
  const plain = /filename="([^"]+)"/iu.exec(header || "");
  return plain ? plain[1] : fallback;
}

// Asks the gateway to format the saved resume text. The text is sent exactly as stored;
// the gateway only formats it. Resolves to { blob, fileName }.
export async function requestBrandedResume({ text, candidateName = "", format }, {
  fetchImpl = globalThis.fetch,
  baseURL = gatewayBaseURL,
  getAccessToken = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data?.session?.access_token || "";
  },
} = {}) {
  if (typeof text !== "string" || !text.trim()) throw new Error(NO_RESUME_TEXT_MESSAGE);
  const label = FORMAT_LABELS[format] || "file";
  let token;
  try { token = await getAccessToken(); } catch { token = ""; }
  if (!token) throw new Error("Workbench could not reach your workspace. Reload the page, then try again.");
  let response;
  try {
    response = await fetchImpl(new URL("/api/resume-format", baseURL), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, format, candidateName }),
    });
  } catch {
    throw new Error(`Workbench couldn’t be reached, so the ${label} file was not made. Check the connection and try again.`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const code = payload?.error?.code;
    if (code === "NO_RESUME_TEXT") throw new Error(NO_RESUME_TEXT_MESSAGE);
    if (code === "UNAUTHORIZED") throw new Error("Your workspace session ended. Reload the page, then try again.");
    if (["UNSUPPORTED_CHARACTER", "RESUME_TOO_LONG", "FORMAT_CHECK_FAILED"].includes(code) && payload.error.message) throw new Error(payload.error.message);
    throw new Error(`The ${label} file could not be made. Try again, or use the other format.`);
  }
  const blob = await response.blob();
  return { blob, fileName: fileNameFromHeader(response.headers?.get?.("content-disposition"), `Resume.${format === "docx" ? "docx" : "pdf"}`) };
}

export function saveBlobAsFile({ blob, fileName }, doc = document, urlApi = URL) {
  const url = urlApi.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = fileName;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => urlApi.revokeObjectURL(url), 1000);
}

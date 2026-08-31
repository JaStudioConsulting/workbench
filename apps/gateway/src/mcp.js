import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { loadRecruitmentContext, REQUIRED_RECRUITER_RULES_PATH } from "./recruitment-package.js";

function textResult(text) { return { content: [{ type: "text", text }] }; }

export async function createMcpRequestHandler({ context, contextLoader = loadRecruitmentContext } = {}) {
  const { authority, pkg } = context ?? await contextLoader();
  if (authority.id !== "recruiter" || !authority.policies?.includes(REQUIRED_RECRUITER_RULES_PATH)) {
    throw new Error("Recruiter authority with mandatory Ja rules is required");
  }
  await pkg.assertSkillFile(REQUIRED_RECRUITER_RULES_PATH);
  const rulesText = await pkg.readSkillText(REQUIRED_RECRUITER_RULES_PATH);
  const routerText = await pkg.readSkillText(authority.routerPath);
  const recruiterText = [rulesText, routerText].join("\n\n");
  return async function handleMcpRequest(req, res) {
    // Stateless mode requires a fresh server and transport for every request.
    const server = new McpServer({ name: "ja-recruiting-workbench", version: "0.1.0" });
    server.registerTool("recruiter", {
      description: "The sole recruiting front door. Returns the recruiter router before an optional validated guide.",
      inputSchema: { capability: z.string().min(1).optional() },
    }, async ({ capability } = {}) => {
      const content = [recruiterText];
      if (capability) {
        const selected = authority.capabilities.find((item) => item.id === capability && ["active", "read_only"].includes(item.status));
        if (!selected) return { content: [{ type: "text", text: `${recruiterText}\n\nRequested capability is unavailable through the recruiter router.` }], isError: true };
        await pkg.assertSkillFile(selected.path);
        content.push(await pkg.readSkillText(selected.path));
      }
      return textResult(content.join("\n\n"));
    });
    server.registerTool("workspace_status", {
      description: "Read-only Workbench safety status.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    }, async () => textResult("Workbench is review-only. Durable storage is unavailable. External writes are disabled."));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}

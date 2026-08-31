import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import {
  loadRecruiterGuide,
  recruiterAuthority,
  recruiterBaseText,
} from "./recruiter-authority.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

async function handleMcp(request) {
  const server = new McpServer({ name: "ja-recruiting-workbench", version: "0.1.0" });

  server.registerTool("recruiter", {
    description: "The sole recruiting front door. Returns Ja's mandatory rules, the Recruiter router, and at most one requested approved guide.",
    inputSchema: z.object({ capability: z.string().min(1).optional() }),
  }, async ({ capability } = {}) => {
    const content = [recruiterBaseText()];

    if (capability) {
      const guide = await loadRecruiterGuide(capability);
      if (!guide) {
        return {
          ...textResult(`${content[0]}\n\nRequested capability is unavailable through the Recruiter router.`),
          isError: true,
        };
      }
      content.push(guide.text);
    }

    return textResult(content.join("\n\n"));
  });

  server.registerTool("workspace_status", {
    description: "Read-only status for this Workbench Site.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, async () => textResult(
    "The Workbench Site and Recruiter authority are online. Google Workspace and durable case data are not connected, so external writes remain unavailable.",
  ));

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({ status: "ready", authority: recruiterAuthority.id });
    }

    if (url.pathname === "/api/mcp/discovery") {
      return json({
        frontDoor: "recruiter",
        tools: [
          { id: "recruiter", access: "router" },
          { id: "workspace_status", access: "read_only" },
        ],
      });
    }

    if (url.pathname === "/mcp") return handleMcp(request);

    if (url.pathname.startsWith("/api/")) {
      return json({
        error: "gateway_unavailable",
        message: "Google Workspace and durable Workbench data are not connected on this Site yet.",
      }, 503);
    }

    return env.ASSETS.fetch(request);
  },
};

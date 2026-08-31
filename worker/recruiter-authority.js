import rulesText from "@jastudioconsulting/recruitment-skills/skills/_JA-RULES.md?raw";
import routerText from "@jastudioconsulting/recruitment-skills/skills/recruiter/SKILL.md?raw";
import manifestText from "@jastudioconsulting/recruitment-skills/skills/capabilities.json?raw";

const REQUIRED_RULES_PATH = "_JA-RULES.md";
const ALLOWED_STATUSES = new Set(["active", "read_only"]);
const manifest = JSON.parse(manifestText);

if (
  manifest?.front_door?.id !== "recruiter"
  || manifest.front_door.path !== "recruiter/SKILL.md"
  || !Array.isArray(manifest.policies)
  || !manifest.policies.includes(REQUIRED_RULES_PATH)
  || !Array.isArray(manifest.capabilities)
) {
  throw new Error("The pinned recruiting package does not expose a valid Recruiter authority");
}

const guideModules = import.meta.glob(
  "../node_modules/@jastudioconsulting/recruitment-skills/skills/recruiter/modules/*/GUIDE.md",
  { query: "?raw", import: "default" },
);

const capabilities = manifest.capabilities
  .filter((item) => item?.id && item?.path && ALLOWED_STATUSES.has(item.status))
  .map((item) => Object.freeze({
    id: item.id,
    path: item.path,
    group: item.group,
    status: item.status,
  }));

export const recruiterAuthority = Object.freeze({
  id: "recruiter",
  rulesPath: REQUIRED_RULES_PATH,
  routerPath: manifest.front_door.path,
  rulesText,
  routerText,
  capabilities: Object.freeze(capabilities),
});

export function recruiterBaseText() {
  return [recruiterAuthority.rulesText, recruiterAuthority.routerText].join("\n\n");
}

export async function loadRecruiterGuide(capabilityId) {
  const selected = recruiterAuthority.capabilities.find((item) => item.id === capabilityId);
  if (!selected) return null;

  const modulePath = `../node_modules/@jastudioconsulting/recruitment-skills/skills/${selected.path}`;
  const loader = guideModules[modulePath];
  if (!loader) throw new Error(`The pinned guide for ${capabilityId} is missing from the Site build`);

  return { capability: selected, text: await loader() };
}

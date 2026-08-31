const PACKAGE_NAME = "@jastudioconsulting/recruitment-skills";
export const REQUIRED_RECRUITER_RULES_PATH = "_JA-RULES.md";

export function validateRecruitmentManifest(manifest) {
  if (manifest?.front_door?.id !== "recruiter" || typeof manifest.front_door.path !== "string") {
    throw new Error("Recruitment manifest must expose recruiter as its sole front door");
  }
  if (!Array.isArray(manifest.policies) || !Array.isArray(manifest.capabilities)) {
    throw new Error("Recruitment manifest is incomplete");
  }
  if (!manifest.policies.includes(REQUIRED_RECRUITER_RULES_PATH)) {
    throw new Error("Recruitment manifest must include the mandatory Ja rules");
  }
  const seen = new Set();
  for (const item of manifest.capabilities) {
    if (!item?.id || !item?.path || seen.has(item.id)) throw new Error("Recruitment manifest contains an invalid capability");
    seen.add(item.id);
  }
  return manifest;
}

export async function validatePublishedRecruitmentAssets(pkg) {
  if (typeof pkg.readSkillText !== "function" || typeof pkg.assertSkillFile !== "function") {
    throw new Error("Recruitment package does not expose safe manifest asset APIs");
  }
  const manifest = validateRecruitmentManifest(JSON.parse(await pkg.readSkillText("capabilities.json")));
  const paths = [manifest.front_door.path, ...manifest.policies, ...manifest.capabilities.flatMap((item) => [item.path, ...(item.required_assets || [])])];
  await Promise.all(paths.map((assetPath) => pkg.assertSkillFile(assetPath)));
  return { capabilityCount: manifest.capabilities.length, assetCount: paths.length };
}

export async function loadRecruitmentContext(load = (name) => import(name)) {
  const pkg = await load(PACKAGE_NAME);
  if (typeof pkg.getRecruiterAuthority !== "function") throw new Error("Recruitment package does not export getRecruiterAuthority");
  await validatePublishedRecruitmentAssets(pkg);
  const authority = await pkg.getRecruiterAuthority();
  if (authority?.id !== "recruiter" || !authority.routerPath || !Array.isArray(authority.capabilities)
    || !Array.isArray(authority.policies) || !authority.policies.includes(REQUIRED_RECRUITER_RULES_PATH)) {
    throw new Error("Recruitment package has an invalid recruiter authority manifest");
  }
  return { authority, pkg };
}

export async function loadRecruitmentAuthority(load) {
  return (await loadRecruitmentContext(load)).authority;
}

export function discoverMcp(authority) {
  if (authority?.id !== "recruiter") throw new Error("Only the recruiter authority may be exposed");
  return {
    frontDoor: "recruiter",
    tools: [
      { id: "recruiter", access: "router" },
      { id: "workspace_status", access: "read_only" },
    ],
  };
}

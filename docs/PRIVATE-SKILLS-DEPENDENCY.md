# Private recruitment authority dependency

Gateway package pin:

`@jastudioconsulting/recruitment-skills = github:JaStudioConsulting/recruitment-skills#0f8e929f28c94098f3f992ab33eb7ba901dd9527`

It is fetched by pnpm, not copied into Workbench. The loader uses the package's public `getRecruiterAuthority()` export. It validates that `recruiter` is the only front door before discovery is returned. Package access must be granted to the CI/deployment identity through the approved Git provider integration; do not add tokens to `.npmrc`, lockfiles, source, or Vercel configuration.

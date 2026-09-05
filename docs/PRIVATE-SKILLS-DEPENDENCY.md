# Private recruitment authority dependency

Gateway package pin:

`@jastudioconsulting/recruitment-skills = github:JaStudioConsulting/recruitment-skills#bbf1bbfdc91bbdd9409c976bd5782a0fc87db0b0`

It is fetched by pnpm, not copied into Workbench. The loader uses the package's public `getRecruiterAuthority()` export. It validates that `recruiter` is the only front door before discovery is returned. Package access must be granted to the CI/deployment identity through the approved Git provider integration; do not add tokens to `.npmrc`, lockfiles, source, or Vercel configuration.

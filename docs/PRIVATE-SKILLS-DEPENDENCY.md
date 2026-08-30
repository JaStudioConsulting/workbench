# Private recruitment authority dependency

Gateway package pin:

`@jastudioconsulting/recruitment-skills = github:JaStudioConsulting/recruitment-skills#9e9a116c2ae3f56b9aef1abff8476698da793fbb`

It is fetched by pnpm, not copied into Workbench. The loader uses the package's public `getRecruiterAuthority()` export. It validates that `recruiter` is the only front door before discovery is returned. Package access must be granted to the CI/deployment identity through the approved Git provider integration; do not add tokens to `.npmrc`, lockfiles, source, or Vercel configuration.

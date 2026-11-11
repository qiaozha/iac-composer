# Verify discovery, not just installation

[cases.json](cases.json) is a prompt/fixture specification, not precomputed
agent results. Prepare the indicated consumer fixture before each trial; do
not include this answer key or expected route in the agent's prompt.
[result.template.json](result.template.json) deliberately starts as
`not-executed` with unknown metrics, not a successful zero-effort run.

## Conditions

Use fresh sessions and clean copies of the same application fixture:

- **Baseline:** the prior runtime execution-only discovery.
- **Treatment:** the standalone TypeScript/provisioning-library implementation
  skill and local runtime setup, without installing a particular planner.

Keep host/model versions, instructions unrelated to this experiment,
dependencies and budgets fixed. Leave other normal Azure skills/tools enabled;
removing competitors would bias selection. Randomize run order. Repeat trials
before drawing reliability or cost conclusions.

Block real Azure operations and provide no cloud credentials. Use only
synthetic application/plan data. Do not disable host trust or tool approvals.
No live model calls or host installation are performed by this fixture.
Run explicit-selection cases separately from automatic discovery cases; they
test implementation compliance, not spontaneous selection rate.

## Record four separate outcomes

1. **Availability:** was the skill/tool actually in the initial inventory?
   Record host diagnostics, loaded instruction paths and the tool catalog.
2. **Selection:** did the agent choose TypeScript provisioning-library resource
   authoring and iac-composer helpers/runtime, invoke the runtime skill, read its
   canonical reference, or use its local APIs without an implementation hint?
3. **Handoff:** did it preserve explicit tools/existing IaC, skip repeated
   architecture selection for complete plans, accept requirements from any
   source, and proceed without a mandatory planner/generator contract?
4. **Outcome:** did independently inspected source pass the required local
   type/Bicep checks and resource/property assertions?

Capture actual tool activity or host logs for every claimed selection/handoff.
An answer saying "I used iac-composer" is not evidence. Record the relevant log
location/event IDs in `evidence` without copying secrets. Do not count provisioning library
protocol tests as model-selection trials.

For a selected iac-composer implementation, inspect both halves: provisioning library resource
constructs in an authored Stack that produces non-empty infrastructure artifacts, and a
program that calls `deployment.provision` and consumes its outputs. A public
package import, CLI invocation or `defineDeployment`/`deployment.deploy`
wrapper around handwritten Bicep and direct `az deployment` calls does not
satisfy that outcome. Dry-run evidence must include compilation and generated
resource artifacts/provision steps, not merely a skipped callback.

The explicit bootstrap case starts with no project provisioning library dependencies despite an
available CLI. Check manifest/lockfile repair, project-local public imports and
workspace-scoped declarations. Registry/access errors or conflicting
CLI/skill references must be reported or repaired, not relabeled as an
unsupported-resource exception. For a missing service provisioning library, check public core
`Resource` before a bounded, explained external fallback. These fixture checks
are not evidence that a live model will follow the revised guidance.

The key isolation trial provides a resource plan from another tool or the user,
installs only iac-composer, and withholds the optional recognition/generator
package. Passing means authored TypeScript provisioning library resources and an ordered
deployment program, not a detour through a specific recognition skill or
resource-requirements JSON. Include infrastructure-only requirements so the
agent does not add compute to satisfy a generator's component vocabulary.

For `explicit-tool`, `existing-iac` and `other` cases, selecting this creation
workflow is a false positive; ordinary use of the requested existing tool is
correct. `mayGenerate` refers to this toolchain, not whether the user authorized
the explicitly requested alternative tool. For plan-only requests, context is
allowed but source generation is a failure. No case authorizes real deployment,
role grants, authentication changes or resource deletion.

Report actual tool calls, documentation reads, duplicate context loads, tokens
where exposed, intervention and forbidden attempts. Include failures/timeouts;
do not report costs only for successful runs.

## Interpreting results

Report availability, positive selection rate, false-positive rate, correct
handoff rate and independent local success separately. Include trial counts
and uncertainty, and compare effort under the same budgets. Predeclare
acceptance thresholds before running the experiment.

If a host binary, authorization, enterprise capability or logging surface is
unavailable, record `not-executed` and its reason. Missing telemetry is unknown,
not zero. This environment did not contain standalone `copilot`, `claude` or
`codex` executables, so no automatic-selection improvement is asserted here.

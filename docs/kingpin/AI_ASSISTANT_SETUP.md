# Set up Kingpin with an AI assistant

Use any assistant that can read the SDK documentation. Terminal access is optional:
an assistant without it can explain the steps while you run commands locally.
No particular model, provider, agent framework, API key, or hosted service is required.
This is an additive onboarding guide for **kingpin-runtime@0.1.0-rc.2**, not a new
integration, runtime capability, or qualification claim.

The goal is a small local demonstration you can inspect: install the exact package,
run its existing example, understand the results, and record the responsibilities
that remain with your application. The assistant helps with setup; it does not
become Kingpin's identity provider, policy authority, reviewer, or executor.

## 1. Give your assistant the contract

Provide these files or links. If your assistant cannot open links, copy the files
from the installed package or attach them yourself. Do not let it fill gaps with
invented API names or an SDK for a different version.

- [SDK contract](../../kingpin/SDK_CONTRACT.md): authoritative shapes, methods and limits
- [Current errors](../../kingpin/SDK_ERRORS.md)
- [Synchronous lifecycle](../../kingpin/SDK_LIFECYCLE_REPAIR.md)
- [Qualified example](../../kingpin/SDK_EXAMPLE.mjs)
- [Installation/status guidance](../../kingpin/README.md)
- [License](../../kingpin/LICENSE) and [attribution](../../kingpin/NOTICE.md)

Use the contract and example together. Documentation describes the supported
boundary; the shipped example is the starting program, not a production template.

## 2. Copy this setup prompt

```text
Help me set up a local Kingpin SDK demonstration using only the documented public
contract for kingpin-runtime@0.1.0-rc.2. Read the supplied contract, error reference,
lifecycle guide and shipped SDK_EXAMPLE.mjs before suggesting code. If you cannot
read them, ask me for their contents rather than guessing.

First establish:
- whether you can run local commands or I will run them;
- my Node version, operating system and architecture;
- a fresh consumer directory that will not overwrite existing project files;
- whether the exact version is available from npm.
Infer these from the environment when possible. Do not request model-provider keys,
production credentials, or database contents. Do not install or replace my Node
runtime automatically.

Qualified environment: Node.js 24.14.1 on macOS/Darwin arm64, using MemoryStateStore
or SQLiteStateStore with Node's node:sqlite DatabaseSync (SQLite 3.51.2 in the RC
qualification). Other environments are unverified, not proven incompatible.
Do not call an unverified environment qualified or silently switch package versions.
If my environment differs, explain the mismatch before proceeding with an explicitly
unverified demonstration.

Use the exact version, not an unpinned or moving tag. If the exact registry version
is unavailable, stop with the missing prerequisite; do not build from a repository
or silently substitute another package version.

Install into the fresh consumer directory. Copy SDK_EXAMPLE.mjs from the installed
package and run it unchanged. It creates example.sqlite exclusively: on a repeat
run use another fresh directory, never delete or overwrite a user's database.
Do not claim success from predicted output. Record the actual command result, or
state clearly that commands have only been proposed and still need to be run.

Only these imports are supported:
kingpin-runtime: KingpinAuthority, MemoryStateStore, loadPolicy, validatePolicy
kingpin-runtime/state/sqlite: SQLiteStateStore
kingpin-runtime/auth: AccessError, createAuthentication, loadAuthentication
No filesystem deep imports, underscore methods, internal execution modules, custom
stores, new adapters, or calls to a real tool are needed for this demonstration.

Explain the observed example: synthetic input requests HUMAN REVIEW; approval alone
does not authorize execution; bound one-use consumption is distinct; leases can be
revoked; reopening SQLite uses a new store and preserves committed review/revocation
state. The example's administrative calls and reviewer identities are trusted demo
host code, not powers to give an untrusted model. It executes no tool.

For ordinary governed dispatch, require the applicable Kingpin decision to have
outcome === 'allow'. HUMAN REVIEW requires successful bound consumption with
execution_authorized === true and an allowing authority_decision. Non-allow
outcomes and exceptions must produce zero dispatch.

Validate and finalize the actual operation before Kingpin evaluation. Submit the
matching tool, arguments, actor and context; dispatch only that exact operation.
New attempts/retries and changed bindings require fresh evaluation. Do not cache
authority. An unchanged pending review follows the documented one-use bound
consumption path. Do not blindly retry a lost successful-consumption response.

Trusted actors/principals come from host-controlled configuration/authentication.
Never construct trusted principals or permissions from workload IDs, roles or
claims. Passing a principal-like object to a direct authority/review API does not
authenticate it.

Human/framework approval, handoff, delegation and resumed workflow state do not
confer or transfer Kingpin authority. Each receiving actor/new operation must
satisfy its own trusted identity, binding and applicable Kingpin authorization path.

Do not change policy, coercions, assertions, trust checks or runtime code to make a
failure pass. Compare errors with the shipped reference. If the contract and actual
behavior disagree, preserve the error and stop that step for separate review.

Finish with: installed version and source, measured environment, files created,
actual checks passed/failed/not run, explanation of authority versus execution,
and remaining host responsibilities. Do not claim production readiness, live
CDE/model integration, or that my application is now protected by Kingpin.
```

## 3. Install and run the existing example

Install the exact public prerelease:

```sh
npm install --save-exact --ignore-scripts --no-audit --no-fund kingpin-runtime@0.1.0-rc.2
cp node_modules/kingpin-runtime/SDK_EXAMPLE.mjs ./SDK_EXAMPLE.mjs
node SDK_EXAMPLE.mjs
```

These commands belong in a fresh consumer directory. Do not paste authentication
tokens into the chat. The example generates ephemeral tokens internally.

The example asserts its outcomes and prints a line beginning
`Memory and SQLite example PASS`. A successful run demonstrates the example on your
environment; it does not repeat the full RC qualification. The example exercises both stores; it is not a selectable-backend CLI.

## 4. Understand what passed

| Observation | Meaning | What it does not prove |
| --- | --- | --- |
| HUMAN REVIEW decision | Synthetic compatible input exercised the documented review path | A live model/CDE detected a risk |
| Approval has execution_authorized false | Review resolution is separate from authorization | Approval grants permission to run a tool |
| Successful bound consumption returns execution_authorized: true in this example | Callers must inspect the returned authorization and native decision | An external operation ran or can be replayed |
| Nonce and epoch revocation checks | Native lease validation reflects revocation | Cancellation of an already-running operation |
| SQLite reopen retains state | The example sees committed review/revocation state through a new store | General crash/power-loss recovery |
| Example PASS | Its actual assertions completed | Production security or full application integration |

## 5. Choose the next bounded step

For an ephemeral experiment, use MemoryStateStore. For local persistence on the
qualified environment, use SQLiteStateStore and host-owned paths, explicit creation,
normal close, and a new instance to reopen. Neither store choice broadens support.

The initial limited SDK release supports the built-in MemoryStateStore and SQLiteStateStore. Custom store injection remains available as an advanced trusted-host extension mechanism. Independently implemented stores have not been qualified and are outside this release’s support and compatibility guarantee. Constructor acceptance does not establish store conformance.

After the unchanged example passes, ask the assistant to outline an integration
before implementing it. That outline must identify who authenticates principals,
selects trustworthy signals and evaluation IDs, owns policy and administrative
operations, handles HUMAN REVIEW, enforces native outcomes, and observes effects.
Treat model output as proposed workload data, not authenticated identity or a grant.

Use loadPolicy/validatePolicy only as documented. Do not weaken policy to manufacture
an allow result. Keep calls and transaction callbacks synchronous. Do not treat
execution-accounting records as proof of effects or a supplied executor. Advanced
accounting integration and real tool execution are separate work, not prerequisites
for completing this onboarding path.

## Completion and troubleshooting

Onboarding is complete when the exact installed version is identified, the real
example passes, the environment is recorded accurately, and the user can explain
these boundaries: authority is not execution; approval is not authorization; lease
validation is point-in-time evidence; the host establishes trusted identity.

These criteria complete demonstration onboarding only. A real dispatch integration
must separately prove zero dispatch/effect for denied attempts and correlate each
dispatched operation to its own applicable fresh authorization. Effect/accounting
evidence remains distinct from authority evidence. The shipped example does not
test dispatch.

| Situation | Response |
| --- | --- |
| Assistant cannot read the contract | Supply the actual documents; do not proceed from guessed interfaces |
| Exact version unavailable | Stop with the missing prerequisite; do not substitute another version |
| SQLite file already exists | Use another fresh directory; preserve the existing file |
| Runtime/platform differs | Label the run unverified; do not broaden the support claim |
| Assertion/error differs from the contract | Retain a redacted error and environment details; stop for review |
| Assistant cannot execute commands | Return commands with status “not run,” not a success claim |

This path adds no promise of hosted-model behavior, production security, distributed
exactly-once execution, cancellation, external rollback, hostile same-user isolation,
network-filesystem support, broader recovery, or arbitrary future upgrades. The SDK
remains a limited prerelease under **CC BY-NC 4.0**, not unrestricted commercial
software. See the contract for the full supported and unsupported scope.

# Epic 2: Slack Integration & HITL Framework

**Goal**: Implement the Slack app integration that will serve as the primary user interface, along with the human-in-the-loop approval framework that ensures governance and control over automated processes.

## Scope and Non-Goals

- In scope: Slack app configuration, slash commands, approval cards, policy evaluation path, channel/thread strategy, MVP observability for approvals.
- Not in scope: Full Run Trace UI (covered in Epic 6), long-term email integrations, enterprise SSO provisioning.

## Environment and Config

Map required environment variables and their roles (see `.env.example`):

- `SLACK_BOT_TOKEN` (xoxb-…): Bot token for `chat.postMessage`, `views.open`, etc.
- `SLACK_SIGNING_SECRET`: Request signature verification for Slack events/commands.
- `SLACK_APP_TOKEN` (xapp-…): Enables Socket Mode when present; falls back to HTTP if omitted.
- `NOTIFY_SERVICE_PORT`, `POLICY_SERVICE_PORT`: Service ports for intra-service calls.
- `NOTIFY_MCP_PORT`, `POLICY_MCP_PORT`: MCP endpoints for future agent-to-service comms.

Implementation note: `notification-service` `SlackService` supports simulation mode when Slack tokens are absent, allowing local testing without external calls.

## Operational Readiness

- Health checks: Provide a simple Slack smoke test via `POST /notifications/slack/test { channel, text? }`.
- Metrics/logging: Log every approval creation/decision with correlation IDs (`run_id`, `approval_id`).
- Rollback plan: Toggle Socket Mode off by removing `SLACK_APP_TOKEN`; service remains operational via simulation mode if tokens are removed.

## Story 2.1: Slack App Configuration and Installation

As a user,
I want to install and configure the MyloWare Slack app,
so that I can interact with the platform through familiar Slack channels.

**Acceptance Criteria:**

1. Slack app created with required scopes and permissions
2. Socket Mode enabled for MVP deployment
3. App installation process documented and tested
4. Required channels (#mylo-control, #mylo-approvals, #mylo-feed) created
5. Bot user configured with appropriate permissions

### Details

- Required Slack scopes (minimum for MVP):
  - Bot token: `chat:write`, `chat:write.customize`, `commands`, `reactions:write`, `users:read`.
  - Optional for modals: `chat:write.public`, `channels:read` (if targeting public channels by name).
- Socket Mode: enabled when `SLACK_APP_TOKEN` is provided; `SlackService` sets `socketMode: true`. Otherwise, use HTTP endpoints via Slack Events API (deferred).
- Channels: create `#mylo-control`, `#mylo-approvals`, `#mylo-feed`.
- Secrets management: store tokens and secrets in `.env` for dev; use secrets manager in prod.

### Install Steps (MVP)

1. Create Slack app in the workspace, add scopes above, and install.
2. Set environment variables in deployment:
   - `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN` (optional for Socket Mode).
3. Start notification service, run smoke test:
   - `POST /notifications/slack/test { "channel": "#mylo-feed" }` → returns `{ success: true, ts }`.

## Story 2.2: Slack Command Implementation

As a user,
I want to use slash commands to interact with the platform,
so that I can easily start workflows, check status, and communicate with the system.

**Acceptance Criteria:**

1. `/mylo new` command implemented with workflow template selection
2. `/mylo status` command with run_id parameter for status checking
3. `/mylo talk` command for conversational interaction
4. `/mylo stop` and `/mylo mute` commands for workflow control
5. Command signature verification and error handling

### Command Catalog (MVP)

- `/mylo new [template] [--title "..."]`:
  - Starts a workflow with optional template; replies ephemerally with a link and thread seed in `#mylo-feed`.
  - Returns `run_id` and the `thread_ts` used for subsequent updates.
- `/mylo status <run_id>`:
  - Replies ephemerally with current status snapshot; posts threaded update in `#mylo-feed`.
- `/mylo talk <message>`:
  - Adds a user comment to the run thread; routed to the orchestrator for context.
- `/mylo stop <run_id>` and `/mylo mute <run_id>`:
  - Stop cancels the run if permissible; mute suppresses non-critical updates for the requester.

### Request Verification

- Verify Slack signatures using `SLACK_SIGNING_SECRET` on all slash-command endpoints.
- Reject requests with 400 if verification fails; never process payloads pre-verification.

### Error Handling

- Ephemeral error replies for user-triggered issues (invalid `run_id`, unknown template).
- Logged errors with correlation fields: `request_id`, `user_id`, `run_id` (if present).

### Testing

- Unit: signature verification logic, parameter parsing for commands.
- Integration: end-to-end flows using Slack simulation mode in `SlackService` (no external calls).

## Story 2.3: Approval Card System

As an approver,
I want interactive approval cards for human-in-the-loop decisions,
so that I can review and approve or deny automated actions that require human oversight.

**Acceptance Criteria:**

1. Approval card generation with context and decision options
2. Interactive buttons for approve, deny, skip, and abort actions
3. Approval event recording in database with audit trail
4. Soft gate timeout handling with auto-approval
5. Hard gate blocking until human decision

### Card Composition (Block Kit)

Example approval card structure:

```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Approval required for action: *Deploy to production*\nRun: `{{run_id}}`\nReason: {{reason}}"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Requested by: <@{{user_id}}>, Priority: *{{priority}}*" }
      ]
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Approve" },
          "style": "primary",
          "value": "approve:{{approval_id}}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Deny" },
          "style": "danger",
          "value": "deny:{{approval_id}}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Skip" },
          "value": "skip:{{approval_id}}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Abort" },
          "value": "abort:{{approval_id}}"
        }
      ]
    }
  ]
}
```

### Interaction Handling

- Button callbacks route to policy decision endpoint, authorize actor, and update the thread with outcome.
- On approval/denial, add reaction (e.g., `:white_check_mark:`/`:x:`) to the original card.

### Testing

- Unit: card payload builder, action parser, actor authorization check.
- Integration: simulated button clicks driving `policy-service.processApproval` and Slack updates via `sendMessage` + `addReaction`.

## Story 2.4: Policy Engine Implementation

As a system administrator,
I want a configurable policy engine that can make automated decisions,
so that the platform can handle routine approvals while escalating complex decisions to humans.

**Acceptance Criteria:**

1. Policy engine with declarative rule configuration
2. Support for allow, soft_gate, and deny outcomes
3. Policy evaluation based on capability, tool metadata, and context
4. Timeout configuration for soft gates
5. Policy dry-run mode for testing

### Evaluation Lifecycle

1. Orchestrator or tool requests policy evaluation → `POST /policies/evaluate`.
2. If conditions fail → `REJECTED` with reason.
3. If conditions pass and no approval required → `APPROVED`.
4. If conditions pass and approval required → create `approval_id`, post card to `#mylo-approvals`, set evaluation `PENDING`.
5. On decision → update evaluation and audit, notify calling context.

The in-repo `PolicyService` already simulates policies, evaluations, approvals, and audit trail in-memory; integrate those flows and expose controller endpoints as needed.

### Decision Matrix (MVP)

- Outcomes: `allow`, `soft_gate`, `deny` mapped to: auto-approve, time-bound pending with auto-approval on timeout, immediate denial.
- Timeouts: soft-gate default 24h (configurable); auto-approval posts a Slack notice.

### Testing

- Unit: condition evaluation operators, audit entry creation, soft-gate timeout.
- Integration: `evaluate → approval_created → approve/deny` happy paths; unauthorized approver rejected.

## Story 2.5: Channel Management and Threading

As a user,
I want organized communication in dedicated channels with proper threading,
so that I can easily track workflow progress and maintain context.

**Acceptance Criteria:**

1. Run updates posted as threads in #mylo-feed keyed by run_id
2. Approval requests posted to #mylo-approvals channel
3. General commands and chat in #mylo-control channel
4. Thread management and cleanup strategies
5. Message formatting with consistent styling and metadata

### Threading Strategy

- `#mylo-feed`: one parent message per `run_id`; use returned `ts` as `thread_ts` for subsequent updates.
- `#mylo-approvals`: approval cards only; card updates remain in the same thread.
- `#mylo-control`: ad-hoc chat and slash-command confirmations.

### Formatting Guidelines

- Prefix messages with concise status tags: `[RUN {{run_id}}][STARTED|IN_PROGRESS|DONE|ERROR]`.
- Include key metadata in a compact table-style section; links to run trace (future) and logs.

### Cleanup

- Auto-archive stale threads after N days (deferred for MVP; document manual cleanup process).

## Consolidated Test Plan (Epic 2)

- Services under test: `notification-service`, `policy-service`.
- Unit tests:
  - Slack simulation mode: `sendMessage`, `sendEphemeralMessage`, `openModal`, `addReaction`, `getUsers` happy/error paths.
  - Command parsing and signature verification.
  - Policy condition operators and decision transitions.
- Integration tests:
  - Slash command to run start → feed thread seeded.
  - Approval flow end-to-end (evaluation → card → decision → audit + reactions).
  - Soft-gate timeout → auto-approval notification.

## Milestones & Exit Criteria

- M1: Slack app installed, smoke test succeeds in `#mylo-feed`.
- M2: Slash commands live for `/mylo new|status` with verification.
- M3: Approval card end-to-end with decisions and audit.
- Exit (Epic complete): All acceptance criteria for Stories 2.1–2.5 met, test plan green, and smoke test documented in README.

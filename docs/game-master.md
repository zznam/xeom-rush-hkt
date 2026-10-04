# Game Master Portal

City Desk is an optional React portal at `/admin/` on the central Deno controller origin. Both `ADMIN_HUB_ENABLED` and `GAME_MASTER_ENABLED` default to off. Existing Vercel/Deno and regional routes continue to work with the flags unset.

## Controls and roles

Select deployment, region, and city before editing. Draft changes remain local until **Review changes → Apply to this city**. The status banner and History report the server acknowledgement. Accepted requests remain pending; an expired request that was delivered has an unknown outcome until its runtime acknowledges it. Reload a stale draft before submitting another configuration.

| Role        | Access                                                                              |
| ----------- | ----------------------------------------------------------------------------------- |
| Owner       | All controls, staff, deployment registration, defaults, audit                       |
| Game Master | Observation, bot and sandbox settings, presets, events, city operations, moderation |
| Moderator   | Observation, announcements, kicks, bans and unbanning                               |

Fixed population starts at eight Normal bots. Automatic fill uses the total target minus human occupants, including disconnected players within reconnect grace, bounded by the configured minimum and maximum. Bots spawn gradually; idle bots leave first, and carrying bots finish their trip. Immediate removal releases passengers and sets fixed population to zero. The hard limit is 50 bots; verify the intended human/bot mix on the actual hosting tier before increasing it.

Skill profiles adjust decision frequency, steering precision and fare/route choices. Personality values independently affect traffic behaviour. Normal retains a decision every simulation tick; Hard improves precision and route choice at the same 20 Hz ceiling. Bots share player physics, fares and penalties. Editing profiles preserves bot IDs, passengers and scores. Population percentages use largest-remainder rounding so the counts always match the requested population.

Career play permits standard bot controls, moderation, announcements and standard rush-hour events. Custom physics, economy, passenger and traffic rules require sandbox. Mode changes and city resets close admissions and show a 30-second Vietnamese countdown. Existing rides finish with results after eligible career writes succeed. A failed write aborts the reset; retrying checkpoints never adds the same earnings twice. Sandbox rides never enter career persistence. Restore standard rules in the draft, or select Career to restore them and review the mode transition.

Pausing stops physics, AI, passenger deadlines, traffic timers and rush-hour timers. Connection health and administrative polling continue. Closing admissions permits an existing player to reconnect; mode transitions reject reconnects while preparing the reset. Kicking invalidates the current reconnect session. A kick permits a later fresh ride; bans reject the deployment guest identity across regions until expiry or unbanning.

## Central Deno controller

Create a GitHub OAuth App with callback URL `https://CONTROL_ORIGIN/api/admin/auth/callback`. Use the numeric GitHub account ID of the owner, obtained from GitHub's account API. Usernames are display labels, never authorization identifiers. No repository, organization, email or other OAuth scopes are requested.

Configure these server-only environment variables on the existing Deno service:

| Variable                     | Value                                                 |
| ---------------------------- | ----------------------------------------------------- |
| `ADMIN_HUB_ENABLED`          | `1`                                                   |
| `ADMIN_ORIGIN`               | Exact HTTPS controller origin, without trailing slash |
| `ADMIN_OWNER_GITHUB_ID`      | Approved numeric GitHub account ID                    |
| `ADMIN_GITHUB_CLIENT_ID`     | OAuth App client ID                                   |
| `ADMIN_GITHUB_CLIENT_SECRET` | OAuth App secret                                      |
| `ADMIN_DEPLOYMENTS_JSON`     | Optional initial deployment registrations, below      |

```json
[
  {
    "id": "legacy-staging",
    "label": "Deno staging",
    "regions": ["local"],
    "token": "REPLACE_WITH_RANDOM_32_PLUS_CHARACTER_SECRET"
  },
  {
    "id": "aws-staging",
    "label": "AWS staging",
    "regions": ["ap-southeast-1", "ap-east-1"],
    "token": "REPLACE_WITH_DIFFERENT_RANDOM_SECRET"
  }
]
```

New registrations can also be created under Deployments. The portal displays their worker credential once. Existing bootstrap registrations are preserved on restart. The configured recovery owner is restored on startup and cannot be removed in the UI. Manage subsequent staff by numeric account ID. Disabling staff takes effect on the next request, including existing sessions. Sign-out revokes the current session. Sessions expire after 12 hours.

Run `bun run build:server && bun run build:admin`. The configured Deno deployment build includes both. The hub opens shared Deno KV in production; all controller instances must use the same KV database. `DENO_KV_PATH` is intended for local files during testing. `ADMIN_STORE=memory` is explicitly development-only and cannot be used by a production hub. GitHub sign-in uses state, PKCE S256, a browser-bound one-use state cookie, and secure HttpOnly SameSite cookies. Every administrative mutation requires the current CSRF token and exact controller Origin.

The portal is served by the controller itself, not the Vercel game frontend. Keep all credentials out of `VITE_*` variables. Existing unauthenticated development controls remain unavailable under the production entrypoint.

## Connect game deployments

Set these values on every participating game process and regional matchmaker:

| Variable                | Value                                           |
| ----------------------- | ----------------------------------------------- |
| `GAME_MASTER_ENABLED`   | `1`                                             |
| `ADMIN_CONTROL_URL`     | Exact HTTPS controller origin                   |
| `GAME_DEPLOYMENT_ID`    | Deployment registration ID                      |
| `ADMIN_WORKER_TOKEN`    | Dedicated credential issued for that deployment |
| `GUEST_IDENTITY_SECRET` | Random signing secret of at least 32 characters |

All AWS regions belonging to one deployment must share the **same identity signing value**. Keep the AWS deployment ID and identity secret separate from the legacy deployment. Preserve the existing regional `GUEST_SECRET`: it still authenticates reservations and verifies old guest credentials during migration.

For AWS Terraform, the new variables are `game_master_enabled`, `admin_control_url`, `game_deployment_id`, `admin_worker_token_arn`, and `guest_identity_secret_arn`. Store actual secret values in regional Secrets Manager; pass ARNs to Terraform. Both room tasks and matchmakers receive the credentials. No additional AWS infrastructure is provisioned for the controller.

Workers register a unique runtime, poll commands every two seconds and publish summary metrics every five seconds. Opening a city renews a 15-second observation window; map and player samples publish once per second during that window. Samples include timestamps. A city becomes stale after 15 seconds without reports. A replacing AWS owner must wait until the prior report is at least 15 seconds old; its saved room configuration is then loaded before admission opens. Legacy instance overrides use the runtime ID and never transfer to replacement instances. New instances use deployment defaults. Changing defaults affects future cities, not existing active cities.

Commands are serialized per city with conditional KV writes, a request ID, expected revision, runtime identity, and 90-second delivery expiry. Long transitions apply at simulation boundaries; the worker retries lost acknowledgements without rerunning the action. A reported revision mismatch blocks further changes until acknowledgement reconciles the saved state. Presets and administrative records also use conditional versions to reject concurrent edits.

Controller calls stay outside the simulation tick. Existing rides keep their applied rules during an outage. Admission requires a fresh ban check and fails closed if the controller is unavailable. Writes cannot be applied through an offline controller. Paused state, temporary announcements and admissions closure are live operations; saved bot/rule configuration survives AWS room replacement.

## Guest careers and migration

The client stores one signed guest identity under `guest:deployment:DEPLOYMENT_ID`. AWS regions share it. Legacy workers and regional matchmakers prove ownership of an existing signed guest token before creating a one-to-one career alias. Both the old profile and its new identity are protected against relinking to another account. Keep browser storage until migration succeeds; the client stops matchmaking when a required link cannot be verified.

Existing signed legacy credentials can retain their ID careers through the same verified link. Legacy ID-based careers use separate KV/Mongo records. Historical name-based scores remain stored, but entering the same nickname grants none of those earnings. Duplicate nicknames belong to independent identities. Career persistence, bans, staff, presets and audit history survive city reset. Guest bans can be bypassed by clearing browser identity; this is an accepted guest-play limitation.

## Verification and release gate

```sh
bun install --frozen-lockfile
bun run lint
bun run test
bun run build:legacy
bun run test:admin
bun run test:legacy
bun run test:regional
bun run test:e2e
bun run test:e2e:regional
bun run test:e2e:admin
bun run test:load
```

The native KV tests exercise conditional writes and career isolation. The managed smoke starts a real KV controller, two Deno legacy instances and two regional cities. It covers selected-city delivery, pause, reconnect, cross-region bans/unban, the 30-second mode change and fail-closed admission during outage. Browser tests cover desktop owner controls and a mobile moderator. The local OAuth provider is mocked in tests; real GitHub sign-in must be verified in staging.

`test:load` opens 64 human WebSocket clients with movement input and 50 bots, checks the capacity boundary, connected streams and tick throughput. Use `LOAD_SECONDS=300 bun run test:load` for a longer local soak. The local 15-second measured run (after warm-up, with the shared game-core integration) maintained about 19.3 Hz with all 64 streams connected. It meets the local smoke floor of 17 Hz but falls below the nominal 20 Hz target. Local throughput is not proof of the chosen Deno tier or ECS task capacity; production enablement and the maximum bot population still require a staging soak.

Roll out using separate staging deployment registrations and identity namespaces:

1. Configure shared KV, GitHub identity, staff authorization and command delivery. Verify real sign-in, revocation, CSRF rejection and lost-acknowledgement recovery.
2. Enable bot controls; load-test the intended population on the hosting resources.
3. Exercise sandbox rules, prediction, save failures, reset and career separation.
4. Exercise regional moderation, migration, expiry/unban and the complete portal. Enable production only after these staging checks pass.

For rollback, close admissions and finish/checkpoint current career rides before disabling managed workers and the hub. Keep KV and regional career tables. Reverting to legacy name-based mode does not merge the separate ID-based career namespace. Never run the test fixtures from `tests/` as public services.

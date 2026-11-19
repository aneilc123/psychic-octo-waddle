# DeepSpace Context Vault

React + TypeScript frontend and a DeepSpace Worker for owner-managed profile
facts, visitor access requests, in-app notifications, and account-bound grants.
The dedicated `/chat` page uses the OpenRouter model configured for the Worker.

## Local checks

```sh
npm install
npm run type-check
npm run lint
npm run test:grant
npm run build
```

DeepSpace builds require a platform-minted app ID in `wrangler.toml`. The
production app is deployed at <https://context-vault.app.space>.

## Data and authorization

- Fact, request, grant, notification, and audit collections are declared under
  `src/schemas/`; only the app owner (`admin`) can read them through RecordRoom.
- Every app API that reads or writes those collections also verifies a signed
  DeepSpace JWT. Visitor requests are scoped to gated facts and the verified
  visitor identity.
- The visitor agent receives public fact values and gated fact labels only.
  Approved gated values are served separately by `/api/access/:id` after an
  account, grant scope, expiry, and revocation check.
- One-view reads are atomically claimed in `VaultGrantRoom` using a Durable
  Object storage transaction. This blocks subsequent server reads; it cannot
  prevent a recipient from copying or capturing a value already displayed.
- OpenRouter credentials and model selection are Worker bindings. Configure
  `OPENROUTER_API_KEY` and optionally `OPENROUTER_MODEL` as deployment secrets.
  No key is included in this repository.
- `/chat` is a separate conversation page. It sends bounded user/assistant
  history to the server; the Worker adds the appropriate owner or visitor
  context before calling OpenRouter. Visitors receive public values and gated
  labels only. Owner requests use server-validated tools.

The app uses DeepSpace authentication, RecordRoom permissions, and Durable
Objects. It makes no claim of client-side or field-level encryption. Verify
the deployed platform's actual storage protections before entering highly
sensitive identifiers.

## Run and deploy

```sh
npm run dev
npm run type-check
npm run lint
npx deepspace test run
npx deepspace deploy
```

Add credentials through the DeepSpace encrypted secrets store, not `.dev.vars`
or a frontend environment variable:

```sh
npx deepspace secrets set OPENROUTER_API_KEY --stdin
```

# iExec Tools Feedback - {HyperSecret}

## Overview

We built {HyperSecret}, an anonymous USDC bridge to Hyperliquid using iExec TEE. The TEE is the core of our privacy model,it's the only component that knows the mapping between depositors and destination addresses.

## Tools Used

- **iApp CLI** (`@iexec/iapp`) - init, test, deploy
- **iExec SDK** (`iexec` npm package) - secrets, orderbook, order matching from frontend
- **iExec CLI** (`iexec`) - wallet management, app order publishing
- **SCONE TEE framework** - SGX enclave execution

## What Worked Well

**iApp CLI is great for getting started.** `iapp init` scaffolds everything you need,Dockerfile, config, entry point. Going from zero to a working TEE app was surprisingly fast. The `iapp test` command for local testing before deploying saved us a lot of time.

**iApp deploy is smooth.** One command builds the Docker image, wraps it for SCONE/SGX, pushes to DockerHub, and deploys on-chain. That's a lot of complexity hidden behind a single command, and it just works.

**The SDK works well from the browser.** We used the iExec SDK directly from our React frontend (hosted on Vercel) to push secrets, fetch orderbooks, and match orders. No backend needed,the user's MetaMask wallet handles signing. This was a big win for our architecture.

**App developer secrets are solid.** Storing our TEE wallet private key as an app developer secret means it's only accessible inside the enclave. Simple API, works as expected.

## Pain Points

**Requester secrets are immutable.** Once you push a secret at index "1", you can never update it. This was a real problem for us since each bridge request has a different destination address. Our workaround was using `Date.now()` as a dynamic secret index for each request, then mapping it via `iexec_secrets: { 1: dynamicIndex }` in the request order params. It works, but it's not obvious from the docs.

**No `arbitrum-sepolia-testnet` in the default chain.json.** After `iexec init`, the chain.json only has bellecour, mainnet, and arbitrum-mainnet. We had to manually add arbitrum-sepolia-testnet. Small thing, but confusing when you're starting out.

**Tag mismatch error is cryptic.** When publishing an app order, if you forget `--tag tee,scone`, you get "Tag mismatch the TEE framework specified by app" with no hint about what tag to use. A more descriptive error message would help.

**No easy way to publish app orders from iApp CLI.** After `iapp deploy`, there's no `iapp publish-order` or similar. You have to switch to the full `iexec` CLI, init a separate config, import the wallet, and run `iexec app publish`. It would be nice if `iapp deploy` could optionally publish an order automatically.

**Docker build time for SCONE.** The TEE wrapping step during `iapp deploy` takes a while. Not a dealbreaker, but when you're iterating on your app code and redeploying, it adds up.

## Suggestions

1. **Make `iapp deploy` publish an app order** by default (or with a `--publish` flag). Right now the gap between deploying and having a usable app in the orderbook requires switching tools.

2. **Add a note in the docs about requester secret immutability** and suggest the dynamic index pattern. This is a common use case (different input per execution) and the current behavior is surprising.

3. **Include all supported chains in the default chain.json**, especially testnets. Developers building for hackathons will almost always need the testnet chain.

4. **Better error messages for tag mismatches.** Something like "Expected tag: tee,scone (based on app configuration)" would save debugging time.

5. **A `iapp run` command that handles secrets inline** was actually already there and it's great. Maybe highlight it more in the docs as the primary way to test deployed apps.

## Overall

iExec TEE tooling is solid. The iApp CLI makes it accessible even if you've never worked with SGX before. The biggest friction was around the edges (secret immutability, order publishing workflow, chain config) rather than the core TEE functionality itself. For a hackathon, we went from idea to working E2E anonymous bridge in under 48h,that says a lot about the developer experience.

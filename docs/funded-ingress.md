# Funded quote ingestion

This increment joins the archived quote, a funding receipt, the verified assessment task and durable worker output. It doesn't enable a public paid offer or economic submission.

`QuoteStore` keeps immutable canonical signed envelopes privately, with file/parent permissions, single-link/inode checks and SHA-256 integrity. Storage doesn't assert cryptographic authenticity. `FundingReader` uses bounded private stdin/stdout IPC to Node; request JSON cannot choose RPC endpoints or supply an attestation.

The Node reader locates `JobFunded` within the signed quote time window, checks its successful receipt, unique matching escrow-token transfer, client/provider/budget and canonical block binding, and verifies the quote signature at that funding timestamp. It binds the quote hash, task, identity and provider to the onchain Pokter description. The current job and registry owner/wallet are checked through two configured public RPCs. Runtime, proxy implementation and implementation-runtime seals are checked at funding and at the current block. Missing historical state stops verification; it doesn't silently substitute a latest read.

`PokterIngress` persists only validated jobs, rejects conflicts, and treats an already-submitted/completed replay as a request for reconciliation, not another delivery or automatic completion. The assessment worker consumes the bound internal task and persists exact receipt/manifest bytes. Its policy and transaction authority remain unchanged.

Local/mock RPCs never receive public attestation. A synthetic fork requires an explicit private-harness mode in ingress and worker; their production defaults reject it. Synthetic provenance stays false for public attestation throughout the pipeline.

## Contract source checks

On 2026-10-10 UTC, verified Etherscan testnet source was recompiled with Solidity 0.8.28. Commerce implementation (12,733 bytes), its ERC-1967 proxy, router implementation (6,685 bytes), token implementation (12,027 bytes) and transparent token proxy match their observed full runtimes after compiler-reported immutable values were patched. OptimisticPolicy's executable runtime matches; its 32-byte metadata digest differs, so its full observed runtime remains separately pinned. Registry runtime and implementation are pinned; source proof is separate from the getter/ownership check.

## Full local protocol evidence

An isolated Anvil Cancun fork executed faucet, exact approval, create/register/setBudget/fund, worker delivery, submit and settlement after 901 seconds of virtual time. The job reached `COMPLETED`, its onchain commitment matched the stored manifest keccak256, and replay returned identical bytes. Those were local EVM transactions, not public-chain hires, real fund movements or campaign actions. The test used impersonation for local transactions, not real-wallet transaction signatures. Its private provider quote signature wasn't released as a public offer.

The two RPC URLs in that test were aliases for one local node; it doesn't prove production backend independence. An initial default-hardfork run was abandoned after a system-contract storage error; a later cold-storage read showed the public fork source lacks historical state. The successful run used explicit Cancun and completed while the needed state was available. Production recovery must handle unavailable archive state explicitly.

The public server remains read-only. Paid negotiation transport, a reviewed submission grant/executor and production completion reconciliation still need to be connected before customers are asked to fund jobs.

# DEMOUSD IssuerFreeze event, 2026-10-11 (post-redeploy contracts)

Covers the real on-chain actions and backfill from the 2026-10-11
`demo-asset-trigger.sh` run against the redeployed testnet contracts
(see `deployments/testnet.json` / `deployments/testnet-demo-asset.json`
as of that date). This will be event id `0` on the current
`EventRegistry`: the redeploy started `NextEventId` back at 0, so the
pre-redeploy event (also id 0 on the OLD `EventRegistry`) is a
separate, unrelated record - see
`docs/event-0-demousd-issuer-freeze.md` for that one.

**Contracts this event lives on** (testnet, post-redeploy):

- `EventRegistry`: `CBKLNYRCZJXMKZUPZRFEZU4SALCOUGXF7MX766ZHVFRH5UN5WXLVDPGG`
- `RiskOracle`: `CCENSA5ANAJAFBFOEB7AFVXYLNFORH55IKAPJLZL2W37G6S3QKHYQOON`
- DEMOUSD asset contract: `CAPGF3AMXYKRJ6CBONVDRIB7NZNP4HPNLJ5U5YKQ67CC5IWRG435PGT3`
- DEMOUSD issuer: `GAZHWYDFGFK2JDE4K74PVCZ6WTLG4IULZ2FFVEYIZDT2JK2YPHJUQP4L`
- DEMOUSD holder: `sylox-demo-holder-2`,
  `GDYENF26KRD2LZHQRLNSUWRLUQ6ASJUJNTXQYOEZDUESMVTUNBFQ66AW` - a fresh
  identity, not the pre-redeploy holder
  (`GCINECIQIQW3W4TTGVFMK7DGTHXYMD22PNYNF5LLJOES3EWDIDM5VFSG`, see the
  old file), which is retired with its own real 150 DEMOUSD balance
  still on it and is never reused.

## Real transactions from the 2026-10-11 run

All times UTC, all successful, in the order they actually landed:

| Step | Action | Transaction hash | stellar.expert |
|---|---|---|---|
| 1 | Holder account created/funded | `f5394546086ccf01827d94cdafdbe76fb7c3b76c1bfbb4f157e875fefffbffbf` | https://stellar.expert/explorer/testnet/tx/f5394546086ccf01827d94cdafdbe76fb7c3b76c1bfbb4f157e875fefffbffbf |
| 1 | Trustline opened (`change-trust`) | `57bf7c54eef72efbe9cfe47e1a63187340eef2d30746f77df83c42d2729e32b5` | https://stellar.expert/explorer/testnet/tx/57bf7c54eef72efbe9cfe47e1a63187340eef2d30746f77df83c42d2729e32b5 |
| 2 | Mint 100 DEMOUSD (21:13:17Z, epoch 497709) | `2050994a9d3d754791142b91a6a2f6567cd6869c623713b8604cfae025ed749e` | https://stellar.expert/explorer/testnet/tx/2050994a9d3d754791142b91a6a2f6567cd6869c623713b8604cfae025ed749e |
| 3 | Backfill `post_signals`, epoch 497705 (21:13:27Z) | `bf014af1ec70bf5f5898e2293f77e5fb714dc943ff6785551ca25119dd8cfe8f` | https://stellar.expert/explorer/testnet/tx/bf014af1ec70bf5f5898e2293f77e5fb714dc943ff6785551ca25119dd8cfe8f |
| 3 | Backfill `post_signals`, epoch 497706 (21:13:37Z) | `b01f153f60434f6ce71668c84926f8e7dca6a587e96760a514782deddb2d677e` | https://stellar.expert/explorer/testnet/tx/b01f153f60434f6ce71668c84926f8e7dca6a587e96760a514782deddb2d677e |
| 3 | Backfill `post_signals`, epoch 497707 (21:13:47Z) | `584b2410f9e25a99ea3eecddd44ddde417ccc307375bb95a28ea143aeabc859d` | https://stellar.expert/explorer/testnet/tx/584b2410f9e25a99ea3eecddd44ddde417ccc307375bb95a28ea143aeabc859d |
| 4 | Authorization revoked (`set_trustline_flags`, clear-authorize) (21:13:57Z, epoch 497709) | `33571297f4e07ddec410c995d63a78f9408f578dfbffec3bce19a5562f5bdc78` | https://stellar.expert/explorer/testnet/tx/33571297f4e07ddec410c995d63a78f9408f578dfbffec3bce19a5562f5bdc78 |
| 4 | Clawback, 50 DEMOUSD (21:14:02Z, epoch 497709) | `7011544d84355e7b0cec520301a719f36f0e9d0514a30a89f60e06ae6ee156cb` | https://stellar.expert/explorer/testnet/tx/7011544d84355e7b0cec520301a719f36f0e9d0514a30a89f60e06ae6ee156cb |

The revoke and the clawback both fall in epoch 497709 (confirmed by
reading each transaction's own `created_at` from Horizon and matching
them against each other before posting anything further -
`demo-asset-trigger.sh` stops with an error rather than guess if they
ever disagree).

## Backfill note: the posted supply is as of the run, not historical

The backfill posts for epochs 497705-497707 recorded `supply =
2,500,000,000` (250 DEMOUSD worth, at `SCALE 1e7`) - the REAL
circulating supply read from Horizon at the moment the backfill ran
(21:13:27Z-21:13:47Z). That read happened AFTER the mint at 21:13:17Z,
which landed in epoch 497709, not in any of the backfilled hours. So
497705 through 497707 are posted with a supply figure that already
includes holder 2's mint, even though that mint had not happened yet
during those real hours - the real supply during 497705-497707 was
1,500,000,000 (150 DEMOUSD), not 2,500,000,000.

This is sample history on a demo asset, not a claim about DEMOUSD's
real historical supply, and it is internally consistent with every
check `post_signals` runs (`check_sanity_bounds`,
`check_supply_change_consistency`, `check_amm_cross_check` -
contracts/risk-oracle/src/lib.rs): each backfill post's own
`supply_change_bps` was computed for real against the PREVIOUS
backfilled epoch's own stored supply (also 2,500,000,000, since all
three backfill posts ran within the same 21:13:2x-4x UTC window,
after the mint, with no further supply change between them), so
`supply_change_bps = 0` for all three is correct relative to each
other - it is only wrong relative to what DEMOUSD's supply would have
actually been read as during those real hours, had anyone posted
during them at the time. Stated here plainly rather than left
implicit, the same correction this file's own companion fix made to
`docs/event-0-demousd-issuer-freeze.md`'s earlier double-mint history.

## The failed first trigger attempt

The first attempt to post the triggering signal (originally computed
for epoch `NEWEST_CLOSED = floor(now/EPOCH_SECS) - 1`, which at that
moment evaluated to 497708, one hour before the real action hour)
failed in simulation with:

```
error: transaction simulation failed: HostError: Error(Contract, #104)
```

`Error(Contract, #104)` is `SanityBoundFailed`. Root cause:
`demo-asset-trigger.sh` hardcoded `supply_change_bps: 0` for the
triggering post, but `check_supply_change_consistency`
(contracts/risk-oracle/src/lib.rs) compares the posted value against
the real change versus the previous epoch's own stored supply - a
real `-2000` bps move (`(2,000,000,000 - 2,500,000,000) * 10000 /
2,500,000,000`) posted as `0` is a diff of `2000`, far past the
contract's own tolerance of `1`. Nothing landed from this attempt:
Soroban simulation caught it before any transaction was ever signed
or submitted. Fixed in `compute_supply_change_bps()`
(`deploy/demo-asset-trigger.sh`), which copies the contract's own
formula exactly.

A second, separate issue was caught before any further attempt:
`NEWEST_CLOSED` itself used wall-clock "now" at script-run time, not
the real hour the revoke and clawback transactions actually closed in
- the wrong epoch entirely (497708, the hour BEFORE the real actions,
not 497709, their own real hour). Fixed by deriving the triggering
epoch from the real transactions' own `created_at` instead
(`read_tx_epoch()`).

## Plan for epochs 497708 and 497709 (pending)

- **Epoch 497708** (the gap hour, immediately before the real action
  hour): a plain post, no issuer actions, supply carried forward from
  497707's own real stored supply (2,500,000,000), `supply_change_bps
  = 0` - correct by construction, since this post deliberately
  carries the same figure forward unchanged. Fills the gap between the
  backfill and the triggering post so `check_supply_change_consistency`
  has a real, contiguous previous slot to compare the trigger against.
- **Epoch 497709** (the real action hour): `supply = 2,000,000,000`
  (real, read from Horizon after the clawback), `supply_change_bps =
  -2000` (real, against 497708's own stored 2,500,000,000),
  `clawback_amount = 500,000,000` (real, from the clawback
  transaction's own effects), `auth_revocations = 1`, `clawbacks = 1`.

Neither has posted yet. **Pending, filled in by the follow-up PR once
this run actually executes for real:**

- Event id: _pending_
- Triggering post's own transaction hash: _pending_
- Final on-chain state (`EventRegistry.event(0)`'s own `state`,
  `NextEventId` afterward): _pending_

Nothing further goes on-chain until this PR is approved, merged, and
there is an explicit go-ahead to run the trigger for real.

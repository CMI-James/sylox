# Event 0: the real DEMOUSD IssuerFreeze event

Recorded ahead of the testnet redeploy that will ship issue #12
(`upgrade()`/`version()`/`migrate()`) and, if ready in time, issue #21
(constructor instead of `initialize`). That redeploy starts
`EventRegistry`'s `NextEventId` back at 0, so this event's own id,
ruling history, and on-chain links stop being reachable through
`event(id)` on whichever `EventRegistry` address is live afterward.
This file is the paper trail once that happens.

**Contracts this event lived on** (testnet, pre-redeploy):

- `EventRegistry`: `CA7CQNGU6X7DAJUN747KZHA3YDNO4GBLWVDU45BUBVKLEV7H3CVIP6EF`
- `RiskOracle`: `CD73S5ZPCPPPI2WSSUMGMEETM7YUSLDNQRHQEZNELB3NBHXJWYAGJEXE`
- DEMOUSD asset contract: `CAPGF3AMXYKRJ6CBONVDRIB7NZNP4HPNLJ5U5YKQ67CC5IWRG435PGT3`
- DEMOUSD issuer: `GAZHWYDFGFK2JDE4K74PVCZ6WTLG4IULZ2FFVEYIZDT2JK2YPHJUQP4L`
- DEMOUSD holder: `GCINECIQIQW3W4TTGVFMK7DGTHXYMD22PNYNF5LLJOES3EWDIDM5VFSG`

## The event record itself

Read via `EventRegistry.event(0)` on 2026-10-11, before the redeploy:

```json
{
  "id": 0,
  "asset": "CAPGF3AMXYKRJ6CBONVDRIB7NZNP4HPNLJ5U5YKQ67CC5IWRG435PGT3",
  "kind": "IssuerFreeze",
  "tier": 1,
  "def_version": 2,
  "state": "Declared",
  "proposer": "GBXYFBRIS5M7S2UDQ64AE4QHSJG7UIN6VRPDDAEBKP724V344GAL5MJP",
  "window_start": 1791637200,
  "proposed_at": 1791662972,
  "declared_at": 1791674357,
  "escalated_at": null,
  "bond": "0",
  "evidence_hash": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

- `proposed_at` (1791662972) = **2026-10-10T20:09:32Z**
- `declared_at` (1791674357) = **2026-10-10T23:19:17Z**

## The real on-chain actions behind it

Not synthetic: a genuine authorization revocation and a genuine
clawback against the DEMOUSD holder's own trustline, both from the
DEMOUSD issuer (`deploy/demo-asset-trigger.sh`'s own real-action step).

| Action | Transaction hash | stellar.expert |
|---|---|---|
| Authorization revocation (`set_trustline_flags`, clear-authorize) | `cd2702badd3dc419301e9905ccec10e741dbceed24a653e8bb20b3d33e55a2f9` | https://stellar.expert/explorer/testnet/tx/cd2702badd3dc419301e9905ccec10e741dbceed24a653e8bb20b3d33e55a2f9 |
| Clawback (50 DEMOUSD) | `ab365a5a5825e5a9986cf05ada9025928f005b9112087c33fdf8524d111a4cf3` | https://stellar.expert/explorer/testnet/tx/ab365a5a5825e5a9986cf05ada9025928f005b9112087c33fdf8524d111a4cf3 |

Both on 2026-10-10, in the `14:2x` UTC range, ahead of `propose_tier1`
(same day, `20:09:32Z`) - matching `demo-asset-trigger.sh`'s own order
(revoke and clawback first, triggering signal posted after, with the
signal carrying the real clawback amount read back from the
transaction's own effects, not a requested figure).

## Contract calls

| Call | Transaction hash | When (UTC) |
|---|---|---|
| `propose_tier1(DEMOUSD, IssuerFreeze, version 2)` | `9a7080a0df0fb178bad9f859394f8d4ca6fc0cf6bfd8af6f8878428c81b22598` | 2026-10-10T20:09:32Z |
| `finalize(0)` | **not located** - see below | 2026-10-10T23:19:17Z (`declared_at`) |

`finalize`'s own transaction hash was not found by the time this was
recorded: it wasn't called by any of the admin, keeper, demo issuer or
deployer identities in the surrounding window (checked each one's own
Horizon transaction history directly), and the RPC's own `getEvents`
retention window had already aged past 2026-10-10 by the time this
search ran. The event's own `declared_at` timestamp (1791674357,
2026-10-10T23:19:17Z) is real and read directly from `EventRegistry`'s
own stored `EventRecord`, so the state transition itself is not in
doubt - only this one transaction link is missing from this record.
If it still matters later, it is findable by searching every
`invoke_host_function` operation against `EventRegistry`
(`CA7CQNGU6X7DAJUN747KZHA3YDNO4GBLWVDU45BUBVKLEV7H3CVIP6EF`) closed
within a few minutes of 2026-10-10T23:19:17Z, once a search tool with
a longer retention window than this testnet RPC's own is available.

## DEMOUSD state at the time of recording

- Holder's real DEMOUSD balance: `150.0000000`. Not 100 minted minus
  50 clawed back: the real sequence was 100 + 100 - 50 = 150. An
  earlier run's own "skip minting if already funded" guard never
  actually worked (it matched `stellar contract invoke --send=no`'s
  raw, double-quoted output against a bare `^[0-9]+$`, which never
  matches a quoted value), so this holder was minted twice before the
  one clawback. Fixed in `parse_i128()`
  (`deploy/demo-asset-trigger.sh`), tested in
  `deploy/test-demo-asset-trigger-parse-i128.sh`. This holder's own
  trustline is now permanently deauthorized with this real 150
  DEMOUSD balance still on it; it is retired, not reused - a reset
  means a fresh holder identity (`sylox-demo-holder-2` going forward),
  never a re-run against this one.
- Real circulating supply at the time `propose_tier1` succeeded: read
  fresh from Horizon's asset-stats endpoint by `demo-asset-trigger.sh`
  itself at posting time (not re-derived here; see that script's own
  posted `inputs_hash` for the exact figures it used).

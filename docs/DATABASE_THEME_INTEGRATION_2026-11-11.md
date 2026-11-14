# Separate database and theme integration candidate

This local candidate combines DB release `3fa6bc81a94d74856771a7df93c5bdbc49015936`
with theme commit `4cc6211f4a5aabd107bfd88cfdc081ee461461df`. Both derive from
released server `c2bbe88246f249a5fa7cd60f3184f55b6b8794bf`. The supplied theme
bundle SHA-256 `179ee6225ace9e61ccfe96983ef17329f5b1bdc91f0b1118edc3265aa468d881`,
parent, commit and tree were verified before import. Both histories are retained.

The standalone DB checkout, branch, source commit and delivery are unchanged.
This candidate does not replace that independently ready release. No publication,
production data/security action, deployment, Mac operation or phone activity is
included. The coordinator owns release ordering and any subsequent authorization.

## Merge boundaries

- `server/api.js`: theme parsing and both locked theme-write guards are retained
  alongside the DB relationship projections, replay/erasure, indexed inbox reads
  and atomic DM send. No broad file replacement was used.
- `server/db.js`: the partial unread index and safe theme projection/import both
  remain. Theme introduces no schema migration or bulk preference rewrite.
- `server/api.integrity.test.mjs`: allowed theme fixtures and the seven-field
  participant identity assertions both remain; history/cursor checks are unchanged.
- `scripts/architecture-baseline.json`: retain both tighter allowances: the two
  backup-scheduler catch entries are removed and Store direct API count is 95.
- `STATUS.md`: the only textual merge conflict was its competing new entries;
  both records are preserved under an explicit current integration entry.

All other theme files and all other DB implementation files retain their parent
stream contents. Source comparisons and independent reviews accompany the exact
combined-tree gate receipt. Earlier standalone gate receipts do not certify this
combination. No runtime rewrite was needed merely to integrate the two streams.

## Policy and release implications

The existing admin-only Pit Team role retains all 12 themes. Guests and all other
roles, including moderators/editors, receive Daylight and Stage. Theme writes
check current server authority under the write lock. Startup/restoration and
account transitions use the theme branch's client authority boundaries. Dormant
restricted preferences remain in storage; safe reads do not rewrite them.

The DB participant/management projection still allowlists only identity fields;
theme integration must not add live profile preferences to those responses.
Account export uses the existing self projection and therefore inherits the safe
resolved theme value; it does not newly export the dormant raw restricted value.
Owned mutes/plans and the disclosed historical caps remain unchanged.

The DB release plan documents additive schema, backup readiness and rollback
constraints. Its statement that theme is excluded describes the preserved
standalone DB delivery; this record extends the source scope for this candidate.
Theme enforcement should ship with compatible clients under separate release
authorization. Older clients can offer choices the new server rejects and lack
the new local startup/selection guards. Windows export/source checks do not prove
signed-build or physical-device behavior; Mac/iOS acceptance remains with its owner.

Current gates and exact commit/tree are in the delivery manifest. Keep the 512 KiB
web budget unchanged. If client release timing is not ready, the standalone DB
release remains available without waiting for this theme candidate.

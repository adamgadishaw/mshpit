# Calendar recovery and completion on Windows

## Preserved source

The original archive `mshpit-recovery-2026-11-10.zip` was verified as
17,340,156 bytes, SHA256
`108d1821989c2a1c0705251ce0e4562f5924a6090491e21c694b20b0e305c12d`.
All 23 manifest files, standalone Git integrity, 172 available commits and
recorded refs matched. The Python launcher was denied by Windows; an independent
Node verifier performed the size/hash/Git checks without executing that launcher.

`calendar-recovery-20261111/preserved` retains the original shallow repository
and patch package. `calendar-exact` retains all **2,914 calendar files**, including
five untracked source/test files, with matching size/SHA256, recorded index and
Git status at `c45b153c941d762221c102a54ab89e0e9457f71a`. Neither is edited.
Separate JSON/log receipts are alongside them. The editable copy initially
matched the same 2,914 bytes/paths and was committed separately as
`4fa645ba26150560c05e298e09209abd4bf8f416` before corrections.

The original shallow boundary was retained before repairing **only the working
repository** from the verified full PC history bundle. Both missing parents,
`531fa4dc` and `7f790787`, are now available; full strict Git integrity passes.
The common PC/Mac ancestor is `b56c58089f5e25e232e10e8ba2ae15458df13a8b`.
Full shared iOS ancestry is retained, not reconstructed from leaf patches.

## Corrections

- One owned clock accepts server time without restarting its effect, advances
  during offline periods, rearms at effective local midnight, and rejects stale
  responses across refresh, background, account replacement and retirement.
- Agenda paging has no fixed row ceiling. The 2,041-row regression reaches every
  loaded row; scope and ordered day groups remain intact. This proves paging of
  loaded data, not completeness of external provider catalogs.
- Spoken rows include the visible event/artist and sold-out status. Agenda dates
  include years. Localized labels use the Gregorian calendar of the actual grid.
  Presentation date parsing covers the offered 1900–2100 Jump range without
  relaxing the canonical performance persistence parser.
- Native action sheets use the current app theme. Captured callbacks retire
  across background/account/route changes and cannot consume a newer menu.
  Global native dismissal is intentionally not used because it can close another
  feature's sheet; physical sheet behavior still needs device acceptance.
- Sparse attendance updates preserve exact, compatible cached display details.
  Incoming timing or a changed date retires the whole inherited timing group
  across typed attendance, Going replacement and refresh hydration, so aliases
  cannot revive an old schedule. Partial timing updates conservatively discard
  cached zone/end/doors/span details until reconfirmed. Identity/provider fields,
  privacy, server-owned membership and other performances remain protected.
- Windows export-isolation report containment uses the platform path separator.
  Directory junction tests remain active. The file-symbolic-link test explicitly
  skips only Windows EPERM; no privileges or trust settings were changed.

## Evidence and remaining gates

The recovered focused baseline reproduced the clock failure: **53 passed / 1
failed**. Additional attendance timing regressions failed before their fixes,
including actual downstream 7 PM versus incoming 10 PM alias selection.

Final combined focus: **133 passed, 0 failed, 1 Windows file-link skip** across
134 tests (`calendar-final-focused.log`). The screen worker separately passed
103 screen/presentation/clock/browse and neighboring cases. The attendance worker
passed 71 focused cases. Independent Astra review reproduced and corrected the
timing-donor issues, then passed 56 attendance/timing cases with no remaining
actionable finding; screen clock/ownership/paging/localization review was clear.
`git diff --check` passes.

The monolithic recovered baseline and first correction gate attempts were
interrupted/superseded and **are not passing full-suite evidence**. Windows denied
an attempt to terminate the superseded gate's known process tree; its wrapper
was interrupted and child completion was uncertain at this checkpoint. No denied
process action was retried. Logs remain preserved.

This is a local calendar review commit. Full combined PC/calendar/messaging
tests, architecture, web budget, fresh exports and native-input verification
belong to the final integration gate. Inherited Windows Worklets harness failures
are owned by the parallel iOS worker. No native compilation, signing, phone or
VoiceOver validation is claimed. No Mac access, dirty D: checkout edit, production
write, push, remote merge, deployment or device installation occurred.

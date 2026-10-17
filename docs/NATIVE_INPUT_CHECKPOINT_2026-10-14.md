# Native input checkpoint — 2026-10-14

Keyboard fix completed before further guest-flow investigation.

- Task AVD `mshpit-api36` had `hw.keyboard=no`; changed to `yes` in `D:\Development\Emulators\avd\mshpit-api36.avd\config.ini` and restarted only that emulator. Original config retained at `.tmp/validation/avd-keyboard-before.ini`.
- Enabled Android's normal on-screen keyboard preference after boot: `adb -s emulator-5554 shell settings put secure show_ime_with_hard_keyboard 1`. This changes keyboard visibility, not a security/permission or virtualization setting.
- Actual public artist TextInput accepted `Drake`, filtered to the real Drake row, and an actual tap on the on-screen Z key changed it to `Drakez`. Back dismissed the keyboard; IME reported `mInputShown=false`, `mDecorViewVisible=false`. Text remained intact and Clear restored the list. Test text was cleared.
- Android AuthScreen now uses the existing KeyboardAvoidingView's `height` mode to keep form content reachable with a software keyboard. iOS/web behavior unchanged. Nine credential-form regression tests passed.
- Native header now reads MSHPIT, using the existing brand mark and current layout/palette.

Evidence: `.tmp/deliverables/mshpit-keyboard-working.png` is actual public search plus QWERTY keyboard (no credentials); `.tmp/validation/keyboard-public-keytap.xml`, `keyboard-public-dismissed-final.xml`, and `keyboard-tests.log` record the checks. Host-PC physical keystrokes could not be injected through the available tools; hardware input is configured on and actual device/on-screen text entry was verified.

## Authentication handoff required

The API is still the disposable localhost backend. `mobile-smoke-preload.mjs` creates a fresh `.tmp/mobile-data-*` SQLite directory and strips service credentials. `/api/login` searches that local SQLite users table and verifies its local password records; it does not delegate to the website account system. Read-only aggregate inspection found one local user row in each disposable database; no identity or password values were read, and no production users were copied. This does not establish that the owner's website account exists locally.

A fresh blank sign-in screen is left ready. Do not direct the owner's real website password here. Root needs to choose a permitted existing test/staging identity/backend, or obtain explicit owner authorization for the owner to create a local test account themselves through normal signup. I have not created an account, entered credentials, changed the API origin, relaxed verification, or fabricated authentication.

Services: restarted emulator qemu PID24828 (launcher3000), Metro15108 and disposable backend23296 preserved; localhost reverse ports3000/8081 restored. No paid service, production write, push, deployment or security changes.

Remaining authorized work is not completed by this checkpoint: native news entry/article/deep-link free-account gate; reproduce broken artist routes; normalize/check native relative image/storage URLs; measured city/maps/festival and scroll QA. Initial code inspection confirms images may be relative and native callers sometimes pass them unchanged, but a production storage defect has not been established. Continue guest code/API checks independently while root coordinates private owner sign-in.

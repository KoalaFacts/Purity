# 0042: Capability + permission signals

**Status:** Proposed
**Date:** 2026-05-28

## Context

ADR 0041 shipped the always-available environment signals
(online, prefers-\*, locale, orientation, DPR, fullscreen). What's
left are the privacy-gated, often-async, browser-quirky APIs that
expose **capabilities** — permissions, battery, network info,
idle detection — that apps still want as signals but that don't
fit a one-shot synchronous read:

- **Permissions API** (`navigator.permissions.query`) — async
  query, mutation via `PermissionStatus.onchange`. Universally
  supported, no gesture required.
- **Battery Status API** (`navigator.getBattery`) — async,
  exposes level / charging events. Removed from Firefox; still
  works in Chromium.
- **Network Information API** (`navigator.connection`) —
  effective type / RTT / save-data. Chrome / Edge only, but
  high-value for the apps that target those platforms.
- **Idle Detection API** (`IdleDetector`) — Chrome-only,
  requires a permission grant **and** a user gesture to start.
  The gesture requirement is the design driver for this ADR.

Apps wire these by hand, often badly: they leak watch IDs, miss
the `change` event, double-prompt for permissions, or pretend
the API is synchronous and ship a flicker.

## Decision

**Add four capability signals to `@purityjs/core`:**

```ts
export function permissionSignal(
  name: PermissionDescriptor['name'] | string,
): ComputedAccessor<PermissionState>;

export type BatteryInfo = {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
};
export function batterySignal(): ComputedAccessor<BatteryInfo | null>;

export type NetworkInformation = {
  effectiveType: '4g' | '3g' | '2g' | 'slow-2g';
  saveData: boolean;
  downlink: number;
  rtt: number;
  type: string;
};
export function networkInformationSignal(): ComputedAccessor<NetworkInformation>;

export type IdleSignalState = {
  user: 'active' | 'idle';
  screen: 'locked' | 'unlocked';
};
export function idleSignal(detector: IdleDetectorLike): ComputedAccessor<IdleSignalState>;
```

Where `IdleDetectorLike` is the structural subset of the
`IdleDetector` interface we depend on (defined locally so the
package doesn't require `@types/wicg-idle-detector`).

All four return `ComputedAccessor` (read-only). All four return
inert constants in an SSR context.

### `permissionSignal`

```ts
const camera = permissionSignal('camera');
when(
  () => camera() === 'granted',
  () => html`<live-camera />`,
);
```

- **Server.** Returns a constant `'prompt'`.
- **Client.** Caches per permission name (one query + one
  listener per name across all callers). Initial value is
  `'prompt'`; the async `navigator.permissions.query({ name })`
  resolves into either `'granted'` / `'denied'` / `'prompt'`.
  The signal then listens for `change` on the returned
  `PermissionStatus`.
- **Errors.** If `query()` rejects (invalid permission name on
  this browser), the signal stays at `'prompt'` and the rejection
  is logged via `console.error`.

### `batterySignal`

```ts
const battery = batterySignal();
when(
  () => (battery()?.level ?? 1) < 0.2 && !battery()?.charging,
  () => html`<low-power-mode />`,
);
```

- **Server.** Returns a constant `null`.
- **Client.** Lazy singleton. Initial value `null`; the async
  `navigator.getBattery()` resolves into the BatteryManager,
  which we copy into a plain `BatteryInfo` object on every
  `chargingchange` / `levelchange` / `chargingtimechange` /
  `dischargingtimechange` event.
- **Unavailable browser.** Permanent `null`. Apps that need a
  Firefox-friendly path read the signal defensively
  (`battery()?.level`).

### `networkInformationSignal`

```ts
const net = networkInformationSignal();
when(
  () => net().saveData || net().effectiveType === 'slow-2g',
  () => html`<lite-mode />`,
);
```

- **Server.** Returns a constant
  `{ effectiveType: '4g', saveData: false, downlink: 10, rtt: 50, type: 'unknown' }`.
- **Client.** Lazy singleton. Reads `navigator.connection`
  (with vendor-prefixed fallbacks); copies the fields into a
  plain object on every `change` event.
- **Unavailable browser.** Returns the SSR-default constant
  permanently.

### `idleSignal`

```ts
const detector = new IdleDetector();
const idle = idleSignal(detector);

button.addEventListener('click', async () => {
  await IdleDetector.requestPermission(); // requires user gesture
  await detector.start({ threshold: 60_000 });
});

when(
  () => idle().user === 'idle',
  () => html`<screen-saver />`,
);
```

- **Server.** Returns a constant
  `{ user: 'active', screen: 'unlocked' }`.
- **Client.** Wraps an existing `IdleDetector` instance. Listens
  to the detector's `change` event and mirrors
  `detector.userState` / `detector.screenState` into the signal.
  Initial value is read synchronously from the detector (so
  pre-started detectors converge immediately).
- **Why a detector instead of options.** `IdleDetector` requires
  a user-gesture-bound `start()` call **and** an explicit
  permission grant. Both are app-flow concerns the framework
  can't anticipate. The signal layer is honest: you build and
  start the detector under your own gesture, then hand it in for
  the signal-shape wrapper.

### Explicit non-features

- **No `geolocationSignal` in this ADR.** The watch-vs-one-shot
  distinction, the gesture-prompt UX, and the rich error model
  (`PERMISSION_DENIED` / `POSITION_UNAVAILABLE` / `TIMEOUT`) make
  geolocation a worse fit for `ComputedAccessor` than for the
  existing `resource()` shape. Apps that need a one-shot read
  use `resource(() => null, async (_, { signal }) =>
new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej)))`.
  Apps that need a watch build a small `state()` + `watchPosition`
  pairing.
- **No `permissionsSignal({ name, ... })` for descriptor-shaped
  permissions** (e.g. `'midi'` with `{ sysex: true }`). v1 takes
  a bare name; descriptors land in a follow-up if needed.
- **No automatic `IdleDetector` permission request.** Apps call
  `IdleDetector.requestPermission()` themselves under a user
  gesture.
- **No `idleSignal` cleanup hook.** The signal doesn't `abort`
  the detector — that's the caller's responsibility (they
  built and started it).
- **No bandwidth / data-usage tracking signal.** The Network
  Information API exposes static estimates only; "actual
  bytes transferred" is request-scope and belongs at the
  resource / fetch layer.

## Consequences

**Positive:**

- Four privacy-gated capabilities lifted into the signal model
  with honest async / unavailable-browser semantics.
- `permissionSignal` collapses ~25 LOC of imperative permission
  watching into one call.
- `batterySignal` / `networkInformationSignal` make
  battery-saver / save-data branching a one-line `when()`.
- `idleSignal`'s "bring your own started detector" shape keeps
  the framework out of the gesture / permission UX while still
  giving callers the signal ergonomics they want.
- All four are tree-shakable and SSR-safe.

**Negative:**

- The Battery / Network / Idle APIs are not Baseline. Apps that
  branch on them must handle the "unavailable" path (null or
  default constant). Documented; the SSR fallback is the same
  shape so isomorphic code reads naturally.
- `idleSignal`'s caller-managed-detector pattern is unusual
  inside Purity (most signals are zero-arg or one-arg
  primitives). Justified by the gesture requirement; the
  alternative is to bake gesture/permission UX into the
  framework, which is worse.
- Locally-typed `IdleDetectorLike` will drift if the spec adds
  fields. Manageable — the signal only reads two fields.

**Neutral:**

- Tests cover SSR constants + mocked `navigator.permissions`,
  `navigator.getBattery`, `navigator.connection`, and a hand-
  rolled `IdleDetector` stub. None of these APIs ship in jsdom.
- Bundle delta: ~700 bytes gzipped for all four combined
  (rough estimate).

## Alternatives considered

**Wrap `IdleDetector` construction + start inside the signal
factory** so callers write `idleSignal({ threshold: 60_000 })`.
Rejected: the factory would need a `.start()` method on the
returned accessor to respect the user-gesture requirement,
which breaks the `ComputedAccessor` shape. Bring-your-own-
detector pushes the gesture concern to the call site, where it
belongs.

**Async signal constructors** that `await` `navigator.permissions
.query()` / `navigator.getBattery()` before returning. Rejected:
breaks the synchronous "drop into a component body" idiom.
Initial-value-then-update is the same pattern the existing
`resource()` already uses.

**Ship `geolocationSignal` here.** Rejected for now (see
non-features). The design space is larger than the other four
combined and deserves its own ADR if it lands.

**Cache `batterySignal` / `networkInformationSignal` instances**
across pages (per origin, via sessionStorage). Rejected:
out-of-scope cleverness; the lazy-singleton pattern already
makes them effectively per-page singletons.

**Type `permissionSignal` strictly to the
`PermissionName` union.** Rejected: that union is incomplete in
`lib.dom` and varies per browser. Accepting `string` keeps the
runtime API honest; TypeScript users still get autocomplete via
the structural overlap with `PermissionDescriptor['name']`.

# 0008. A service method learns who calls it from the core, never from the caller

Status: Accepted
Date: 2026-11-24

## Context

A module offers a service with `services["x.y"].method(ctx, args)` and another module calls it with `ctx.api.services.call` (`src/core/modules/dependencies.ts`). The provider received only `args`, chosen entirely by the caller. A provider that keeps resources for its callers (the Discord connector's managed messages have an `owner` string) could not enforce "only the module that created this resource may change it": any caller could write any owner in its arguments.

## Decision

The core adds the caller's identity to what the method receives, and nothing the caller sends can influence it.

- `callerOf(consumer)` in `dependencies.ts` builds `{ kind: "module", id, instance, instanceId }` from the consumer instance the core resolved in its own registry; `CORE_CALLER` is `{ kind: "core" }` and is used only by `callProvider` (core code). Both are frozen objects without a prototype.
- `runOn`, the only function that runs a service method, takes the caller as a required parameter, passes it as the **third argument** and defines it as the read-only, non-configurable `ctx.caller`. Existing methods `(ctx, args)` ignore it: additive and backward compatible.
- The identity is the **immediate** caller, not carried through chains: X calls A, A calls B, B sees A (never X). It is a fact for the provider to use, not a permission: the core does not block anything by it, and a provider must never grant privileges to `kind: "core"` (it means the core called, not "trusted").
- Method lookup is one shared function, `serviceMethod`: own-property check on the service table and on the method, plain name shape, must be a function. Found by review: without it `method: "constructor"` resolved to `Object`, which returns the provider's `ctx` to the consumer.
- Modules require it with `"minCore": "0.48.0"`; the conformance kit (`compat.minCore`) asks for it when a method takes a third parameter or reads `ctx.caller`, and `fakeCtx({ caller })` supports unit tests.

## Consequences

- A provider can bind a resource to `caller.instanceId` (stable) and refuse other callers; an instance deleted and created again does not inherit it.
- `tests/modules-mgmt/service-caller.test.mjs` fails if a new file reaches `def.services`, or if a call to `runOn` does not name its caller: a new way to invoke a service must decide who the caller is and update `docs/MODULES.md`.
- It does not defend against a module that runs hostile code in the site process (it can read the database); that stays a matter of which modules the owner installs (see `docs/SECURITE.md`).

## Sources

`src/core/modules/dependencies.ts` (`callerOf`, `CORE_CALLER`, `runOn`, `dispatch`, `callServiceAll`, `callProvider`), `src/core/modules/types.ts` (`ServiceCaller`, `ModuleContext.caller`), `docs/MODULES.md` ("Who calls a service"), `docs/SECURITE.md`, `tests/modules-mgmt/service-caller.test.mjs`.

---
name: Post-merge dependency restore
description: Handling Replit package-firewall failures during automatic post-merge setup
---

The post-merge hook must remain non-interactive, idempotent, and finish by compiling the server and client.

If `npm ci` is blocked by the Replit package firewall because of a vulnerable transitive dependency, update that dependency to its current safe release. Do not bypass the firewall and do not leave the workspace with a partially deleted `node_modules`.

**Why:** `npm ci` removes the existing installation before downloading packages. A firewall rejection can therefore remove build binaries even though the project worked before the command.

**How to apply:** Identify the blocked package and its parent from the lockfile, upgrade the direct dependency or add a safe override/direct version, restore packages through the package-management flow, then run the configured post-merge setup again.
import crypto from "node:crypto";

// Demo-only authority provider. CDE never creates or validates these leases.
// Replace this interface with a separate authority integration in future.
export class DemoAuthority {
  constructor(clock = Date.now) {
    this.clock = clock;
    this.leases = new Map();
  }

  issue({ tool, scope, seconds }) {
    const s = Number(seconds);
    const expiresAtMs = this.clock() + Math.floor(s * 1000);
    if (typeof tool !== "string" || !tool.trim() || typeof scope !== "string" || !scope.trim()
        || !Number.isFinite(s) || s <= 0 || !Number.isFinite(expiresAtMs)
        || expiresAtMs > 8.64e15) {
      throw new Error("body must include tool, scope, seconds>0 within supported expiry range");
    }
    const token = crypto.randomUUID();
    this.leases.set(token, { tool, scope, expires_at_ms: expiresAtMs });
    return { lease_token: token, expires_at: new Date(expiresAtMs).toISOString() };
  }

  hasValidLease(token, tool, scope) {
    const lease = this.leases.get(token);
    if (!lease) return false;
    if (lease.expires_at_ms <= this.clock()) {
      this.leases.delete(token);
      return false;
    }
    return lease.tool === tool && lease.scope === scope;
  }
}

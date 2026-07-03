import { randomUUID } from 'node:crypto';

export interface AcquireParams {
  clientId: string;
  priority: number;
  ttlMs: number;
}

export interface AcquireResult {
  granted: boolean;
  lease_id?: string;
  expires_at?: number;
  retry_after_ms?: number;
}

export interface RenewParams {
  leaseId: string;
  clientId: string;
}

export interface RenewResult {
  ok: boolean;
  expires_at?: number;
  reason?: string;
}

export interface ReleaseParams {
  leaseId: string;
  clientId: string;
}

export interface ReleaseResult {
  ok: boolean;
}

export interface BrainLogPayload {
  message: string;
  module: string;
  level: string;
  context: Record<string, unknown>;
}

interface Lease {
  leaseId: string;
  clientId: string;
  priority: number;
  expiresAt: number;
}

interface PendingPreempt {
  clientId: string;
  priority: number;
  ttlMs: number;
  resolve: (result: AcquireResult) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

export interface DesktopLeaseBrokerOptions {
  ttlMs?: number;
  watchdogIntervalMs?: number;
  onWatchdogTrigger?: (lease: { clientId: string; leaseId: string }) => void;
  onBrainLog?: (payload: BrainLogPayload) => void;
  onYield?: (lease: { clientId: string; leaseId: string }) => void;
  yieldWaitMs?: number;
  tenantId?: string;
}

export class DesktopLeaseBroker {
  private currentLease: Lease | null = null;
  private pendingPreempt: PendingPreempt | null = null;
  private readonly ttlMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly yieldWaitMs: number;
  private readonly tenantId: string;
  private readonly onWatchdogTrigger?: DesktopLeaseBrokerOptions['onWatchdogTrigger'];
  private readonly onBrainLog?: DesktopLeaseBrokerOptions['onBrainLog'];
  private readonly onYield?: DesktopLeaseBrokerOptions['onYield'];
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: DesktopLeaseBrokerOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 10000;
    this.watchdogIntervalMs = opts.watchdogIntervalMs ?? 5000;
    this.yieldWaitMs = opts.yieldWaitMs ?? 2000;
    this.tenantId = opts.tenantId ?? '';
    this.onWatchdogTrigger = opts.onWatchdogTrigger;
    this.onBrainLog = opts.onBrainLog;
    this.onYield = opts.onYield;

    this.watchdogTimer = setInterval(() => this._runWatchdog(), this.watchdogIntervalMs);
  }

  async acquire(params: AcquireParams): Promise<AcquireResult> {
    const now = Date.now();

    if (!this.currentLease) {
      const lease: Lease = {
        leaseId: randomUUID(),
        clientId: params.clientId,
        priority: params.priority,
        expiresAt: now + params.ttlMs,
      };
      this.currentLease = lease;
      return { granted: true, lease_id: lease.leaseId, expires_at: lease.expiresAt };
    }

    const held = this.currentLease;

    if (params.priority < held.priority) {
      // 高优先级抢占
      this.onYield?.({ clientId: held.clientId, leaseId: held.leaseId });

      return new Promise<AcquireResult>((resolve) => {
        const timeoutHandle = setTimeout(() => {
          // 超时强制清除
          this.currentLease = null;
          this.pendingPreempt = null;
          const newLease: Lease = {
            leaseId: randomUUID(),
            clientId: params.clientId,
            priority: params.priority,
            expiresAt: Date.now() + params.ttlMs,
          };
          this.currentLease = newLease;
          resolve({ granted: true, lease_id: newLease.leaseId, expires_at: newLease.expiresAt });
        }, this.yieldWaitMs);

        this.pendingPreempt = {
          clientId: params.clientId,
          priority: params.priority,
          ttlMs: params.ttlMs,
          resolve,
          timeoutHandle,
        };
      });
    }

    // 同等或低优先级——拒绝
    return { granted: false, retry_after_ms: held.expiresAt - now };
  }

  async renew(params: RenewParams): Promise<RenewResult> {
    if (!this.currentLease) {
      return { ok: false, reason: 'lease_not_found' };
    }
    if (this.currentLease.leaseId !== params.leaseId) {
      return { ok: false, reason: 'lease_not_found' };
    }
    if (this.currentLease.clientId !== params.clientId) {
      return { ok: false, reason: 'not_owner' };
    }
    const newExpiry = Date.now() + this.ttlMs;
    this.currentLease.expiresAt = newExpiry;
    return { ok: true, expires_at: newExpiry };
  }

  async release(params: ReleaseParams): Promise<ReleaseResult> {
    if (!this.currentLease || this.currentLease.leaseId !== params.leaseId) {
      // 幂等：已释放或不存在的 lease 也返回 ok
      return { ok: true };
    }

    this.currentLease = null;

    // 若有待抢占方，立即授予
    if (this.pendingPreempt) {
      const pending = this.pendingPreempt;
      this.pendingPreempt = null;
      clearTimeout(pending.timeoutHandle);

      const newLease: Lease = {
        leaseId: randomUUID(),
        clientId: pending.clientId,
        priority: pending.priority,
        expiresAt: Date.now() + pending.ttlMs,
      };
      this.currentLease = newLease;
      pending.resolve({ granted: true, lease_id: newLease.leaseId, expires_at: newLease.expiresAt });
    }

    return { ok: true };
  }

  private _runWatchdog(): void {
    if (!this.currentLease) return;
    const now = Date.now();
    if (this.currentLease.expiresAt < now) {
      const expired = this.currentLease;
      this.currentLease = null;

      this.onWatchdogTrigger?.({ clientId: expired.clientId, leaseId: expired.leaseId });

      const logPayload: BrainLogPayload = {
        message: 'desktop_lease_watchdog_triggered',
        module: 'desktop_lease',
        level: 'warn',
        context: {
          tenant_id: this.tenantId,
          client_id: expired.clientId,
          lease_id: expired.leaseId,
        },
      };
      this.onBrainLog?.(logPayload);
    }
  }

  destroy(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.pendingPreempt) {
      clearTimeout(this.pendingPreempt.timeoutHandle);
      this.pendingPreempt = null;
    }
  }
}

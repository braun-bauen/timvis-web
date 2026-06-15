export type Action = "warn" | "block" | "unblock";

export type DialogOptions = {
  type: "warn" | "block";
  message: string;
};

export type StatusMessage = {
  blocked: boolean;
  showWarning: boolean;
  debug: boolean;
};

export type StoredState = {
  hourKey: string;
  usedMs: number;
  warningShown: boolean;
  blocked: boolean;
};

export type BlockedDomainConfig = {
  id: string;
  domain: string;
  limitMs: number;
  whitelistedPaths: string[];
};

export type ExtensionOptions = {
  blockedDomains: BlockedDomainConfig[];
};

export type RuntimeMessage = {
  type: "tick" | "getStatus" | "debug"
  elapsedMs?: number;
  action?: Action;
};

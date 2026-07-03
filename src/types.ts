export type Action = "warn" | "block" | "unblock";

export type DialogOptions = {
  type: "warn" | "block";
  message: string;
};

export type StatusMessage = {
  blocked: boolean;
  showWarning: boolean;
  debug: boolean;
  whitelisted: boolean;
  domainConfigId?: string;
  domain?: string;
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

export type ValidatedDomain = {
  domain: string;
  error?: "empty" | "duplicate";
}


export type RuntimeMessage = {
  type: "tick" | "getStatus" | "debug" | "optionsChanged";
  elapsedMs?: number;
  action?: Action;
  url?: string;
};

export type Action = "warn" | "block" | "unblock" | "refresh";

export type DialogOptions = {
  type: "warn" | "block";
  message: string;
};

export type StatusMessage = {
  blocked: boolean;
  downtime: boolean;
  showWarning: boolean;
  debug: boolean;
  whitelisted: boolean;
  domainConfigId?: string;
  domain?: string;
  usedMs?: number;
  allowanceMs?: number;
  remainingMs?: number;
  resetAt?: number;
  downtimeActive?: boolean;
};

export type StoredState = {
  hourKey: string;
  resetHours?: number;
  resetAt?: number;
  usedMs: number;
  warningShown: boolean;
  blocked: boolean;
};

export type DomainData = {
  id: string;
  url: string;
  limitMs: number;
  resetHours?: number;
  whitelistedPaths: string[];
  downtimeRules: DowntimeRule[];
  downtimeSchedule?: DowntimeSchedule;
};

export type DowntimeRule = {
  id: string;
  weekdays: number[];
  startMinutes: number;
  endMinutes: number;
  allDay: boolean;
  allowWhitelistedPaths: boolean;
};

export type DowntimeSchedule = {
  enabled: boolean;
  allowWhitelistedPaths: boolean;
  days: {
    weekday: number;
    enabled: boolean;
    startMinutes: number;
    endMinutes: number;
  }[];
};

export type ExtensionData = {
  domains: DomainData[];
};

export type ValidatedUrl = {
  url: string;
  error?: "empty" | "duplicate";
};

export type RuntimeMessage = {
  type: "tick" | "getPopupStatus" | "getStatus" | "debug" | "optionsChanged";
  elapsedMs?: number;
  action?: Action;
  url?: string;
  addedDomain?: string;
  domainConfigId?: string;
};

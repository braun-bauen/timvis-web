export type Action = "warn" | "block" | "unblock" | "refresh";

export type DialogOptions = {
  type: "warn" | "block";
  message: string;
};

export type DialogResult = { action: "save"; value: string } | { action: "cancel" };

export type DomainFormElements = {
  unitInput: HTMLCalciteSelectElement;
  limitInput: HTMLCalciteInputElement;
  whitelistInput: HTMLCalciteTextAreaElement;
};

export type StatusMessage = {
  blocked: boolean;
  downtime: boolean;
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

export type DomainData = {
  id: string;
  url: string;
  limitMs: number;
  whitelistedPaths: string[];
  downtimeRules: DowntimeRule[];
};

export type DowntimeRule = {
  id: string;
  weekdays: number[];
  startMinutes: number;
  endMinutes: number;
  allDay: boolean;
  allowWhitelistedPaths: boolean;
};

export type ExtensionData = {
  domains: DomainData[];
};

export type ValidatedUrl = {
  url: string;
  error?: "empty" | "duplicate";
};

export type RuntimeMessage = {
  type: "tick" | "getStatus" | "debug" | "optionsChanged";
  elapsedMs?: number;
  action?: Action;
  url?: string;
};

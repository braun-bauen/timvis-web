export type Action = "warn" | "block";

export type DialogOptions = {
  type: Action;
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

export type RuntimeMessage = {
  type: "tick" | "getStatus" | "debug"
  elapsedMs?: number;
  action?: Action;
};

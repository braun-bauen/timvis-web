function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateStatus(status) {
  const statusEl = document.getElementById("status");
  const detailEl = document.getElementById("detail");

  if (!status) {
    statusEl.textContent = "Status unavailable.";
    detailEl.textContent = "";
    return;
  }

  const remaining = Math.max(0, status.limitMs - status.usedMs);

  statusEl.classList.remove("warn", "blocked");

  if (status.blocked) {
    statusEl.textContent = "Blocked for this hour";
    statusEl.classList.add("blocked");
    detailEl.textContent = "Time resets at the top of the next hour.";
    return;
  }

  if (status.usedMs >= status.warnAtMs) {
    statusEl.textContent = `Nearly out of time (${formatTime(remaining)} left)`;
    statusEl.classList.add("warn");
    detailEl.textContent = "Wrap up any current tasks on Twitter.";
    return;
  }

  statusEl.textContent = `Time remaining: ${formatTime(remaining)}`;
  detailEl.textContent = `Limit per hour: ${formatTime(status.limitMs)}.`;
}

chrome.runtime.sendMessage({ type: "getStatus" }, (status) => {
  updateStatus(status);
});

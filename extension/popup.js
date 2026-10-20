const profileEl = document.getElementById("profile");
const serverEl = document.getElementById("server");
const tokenEl = document.getElementById("token");
const collectEl = document.getElementById("collect");
const stopEl = document.getElementById("stop");
const logEl = document.getElementById("log");
const statusEl = document.getElementById("status");
const connectionEl = document.getElementById("connection");

function setRunning(running) {
  collectEl.disabled = running;
  stopEl.disabled = !running;
  profileEl.disabled = running;
  document.body.classList.toggle("running", running);
  if (running) statusEl.textContent = "Collecting";
}

function renderLog(lines) {
  const items = lines?.length ? lines : ["Open a results page, then collect."];
  logEl.replaceChildren();
  for (const line of items) {
    const li = document.createElement("li");
    li.textContent = line;
    logEl.appendChild(li);
  }
  logEl.scrollTop = logEl.scrollHeight;
}

chrome.storage.local.get(["profile", "server", "token"], (saved) => {
  if (saved.profile) profileEl.value = saved.profile;
  if (saved.server) serverEl.value = saved.server;
  if (saved.token) tokenEl.value = saved.token;
});

function saveSettings() {
  chrome.storage.local.set({
    profile: profileEl.value,
    server: serverEl.value.trim(),
    token: tokenEl.value.trim(),
  });
}

for (const el of [profileEl, serverEl, tokenEl]) {
  el.addEventListener("change", saveSettings);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "idle") setRunning(false);
  if (message?.type === "progress" && message.log) renderLog(message.log);
});

chrome.runtime.sendMessage({ type: "status" }, (state) => {
  if (state?.log) renderLog(state.log);
  if (state?.running) {
    setRunning(true);
    return;
  }
  const last = state?.log?.[state.log.length - 1] || "";
  statusEl.textContent = /Uploaded /.test(last) ? "Uploaded" : "Ready";
});

stopEl.addEventListener("click", () => {
  stopEl.disabled = true;
  chrome.runtime.sendMessage({ type: "stop" });
});

collectEl.addEventListener("click", async () => {
  saveSettings();
  const token = tokenEl.value.trim();
  const server = serverEl.value.trim();
  if (!token) {
    connectionEl.open = true;
    statusEl.textContent = "Token needed";
    renderLog(["Open Connection and paste the token from the server window."]);
    return;
  }
  setRunning(true);
  renderLog(["Reading this search…"]);
  try {
    const result = await chrome.runtime.sendMessage({
      type: "collect",
      profile: profileEl.value,
      server,
      token,
    });
    if (!result?.ok && !result?.stopped) {
      const message = result?.error || "Collect failed.";
      const items = [...logEl.querySelectorAll("li")].map((li) => li.textContent);
      if (items[items.length - 1] !== message) renderLog([...items, message]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const items = [...logEl.querySelectorAll("li")].map((li) => li.textContent);
    renderLog([...items, message]);
  } finally {
    setRunning(false);
    const last = logEl.lastElementChild?.textContent || "";
    statusEl.textContent = /Uploaded /.test(last) ? "Uploaded" : "Ready";
  }
});

const state = {
  items: [],
  selectedId: null,
  editorBaseline: null,
  hasInitialAutoSelection: false,
  lastResponseCacheHit: false,
  selectedCacheHit: false,
  showOnlyDeletable: false,
  usageTileCollapsed: false,
  codexUsageSummary: null,
  codexUsageError: "",
  codexUsageFetchedAtISO: "",
  usageSummary: null,
  usageError: "",
  usageFetchedAtISO: ""
};

const USAGE_OVERVIEW_PANEL_ID = "__usage_overview__";
const CODEX_USAGE_PANEL_ID = "__codex_usage__";
const USAGE_PANEL_ID = "__firestore_usage__";
const USAGE_PANEL_HOURS = 24 * 14;
const USAGE_FETCH_TIMEOUT_MS = 8000;
const FIREBASE_USAGE_PAGE_URL = "https://console.firebase.google.com/project/hush-pointer/firestore/databases/-default-/usage/prev-24h";
const CODEX_USAGE_PAGE_URL = "https://chatgpt.com/codex/settings/usage";
const FIRESTORE_USAGE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CODEX_USAGE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

let usageRefreshInFlight = null;

function usageSourceFooterLines() {
  return [
    "",
    `<small><a href="#" class="usage-refs-trigger" data-open-usage-refs="1">refs:</a> [firebase usage](${FIREBASE_USAGE_PAGE_URL}) | [codex usage](${CODEX_USAGE_PAGE_URL})</small>`
  ];
}

const el = {
  memoList: document.getElementById("memoList"),
  appTitle: document.getElementById("appTitle"),
  qInput: document.getElementById("qInput"),
  projectInput: document.getElementById("projectInput"),
  typeSelect: document.getElementById("typeSelect"),
  newBtn: document.getElementById("newBtn"),
  projectNameInput: document.getElementById("projectNameInput"),
  memoTypeInput: document.getElementById("memoTypeInput"),
  threadTitleInput: document.getElementById("threadTitleInput"),
  bodyModeToggle: document.getElementById("bodyModeToggle"),
  memoBodyInput: document.getElementById("memoBodyInput"),
  memoPreview: document.getElementById("memoPreview"),
  dateText: document.getElementById("dateText"),
  saveBtn: document.getElementById("saveBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  downloadFormatSelect: document.getElementById("downloadFormatSelect"),
  downloadBtn: document.getElementById("downloadBtn"),
  copyBodyBtn: document.getElementById("copyBodyBtn"),
  shareBtn: document.getElementById("shareBtn"),
  status: document.getElementById("status")
};

async function request(path, options) {
  const res = await fetch(path, options);
  state.lastResponseCacheHit = String(res.headers.get("X-Cache") || "").toUpperCase() === "HIT";
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

function setStatus(message, isError = false, tone = "default") {
  const selectedMemo = state.items.find((memo) => memo.id === state.selectedId);
  el.status.textContent = message;
  el.status.classList.remove("text-[#5d79a8]", "text-[#c96f8a]", "text-[#cf7896]");
  if (isError) {
    el.status.classList.add("text-[#c96f8a]");
    return;
  }
  if (tone !== "force" && selectedMemo && selectedMemo.deletable) {
    el.status.textContent = `Deletable: ${selectedMemo.id}`;
    el.status.classList.add("text-[#cf7896]");
    return;
  }
  if (tone === "danger") {
    el.status.classList.add("text-[#cf7896]");
    return;
  }
  el.status.classList.add("text-[#5d79a8]");
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad2 = (n) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function isUsagePanelSelected() {
  return state.selectedId === USAGE_PANEL_ID;
}

function isCodexUsagePanelSelected() {
  return state.selectedId === CODEX_USAGE_PANEL_ID;
}

function isUsageOverviewPanelSelected() {
  return state.selectedId === USAGE_OVERVIEW_PANEL_ID;
}

function isReadOnlyPanelSelected() {
  return isUsageOverviewPanelSelected() || isUsagePanelSelected() || isCodexUsagePanelSelected();
}

function isSpecialPanelId(id) {
  return id === USAGE_OVERVIEW_PANEL_ID || id === USAGE_PANEL_ID || id === CODEX_USAGE_PANEL_ID;
}

function formatPercent(value, digits = 3) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "-";
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function resetDateText(window) {
  return formatDate(window?.resetAtISO);
}

function getUsageOverviewFetchedAtISO() {
  const fsISO = state.usageFetchedAtISO || state.usageSummary?.endTime || "";
  const codexISO = state.codexUsageFetchedAtISO || state.codexUsageSummary?.fetchedAtISO || "";
  const fsMs = fsISO ? new Date(fsISO).getTime() : NaN;
  const codexMs = codexISO ? new Date(codexISO).getTime() : NaN;
  if (Number.isFinite(fsMs) && Number.isFinite(codexMs)) {
    return fsMs <= codexMs ? fsISO : codexISO;
  }
  if (Number.isFinite(fsMs)) return fsISO;
  if (Number.isFinite(codexMs)) return codexISO;
  return "";
}

function boldPercent(value, digits = 1) {
  return `**${formatPercent(value, digits)}**`;
}

function applyPressureBadgeBorder(elm, usedPercent) {
  const v = Math.max(0, Math.min(100, Number(usedPercent || 0)));
  elm.classList.remove("border-[#7fb08a]", "border-[#d6a56a]", "border-[#d28b99]", "bg-[#fdecef]");
  if (v < 50) {
    elm.classList.add("border-[#7fb08a]");
  } else if (v < 80) {
    elm.classList.add("border-[#d6a56a]");
  } else {
    elm.classList.add("border-[#d28b99]", "bg-[#fdecef]");
  }
}

function getFirestoreTodaySnapshot() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const perDay = Array.isArray(state.usageSummary?.perDay) ? state.usageSummary.perDay : [];
  const today = perDay.find((d) => d.date === todayKey) || perDay[perDay.length - 1] || { read: 0, write: 0, delete: 0, date: todayKey };
  const recent = perDay.slice(-14);
  const limits = state.usageSummary?.limitsDaily || { read: 50000, write: 20000, delete: 20000 };
  const ratePercent = {
    read: Number(today?.ratePercent?.read ?? ((Number(today.read || 0) / Math.max(1, Number(limits.read || 1))) * 100)),
    write: Number(today?.ratePercent?.write ?? ((Number(today.write || 0) / Math.max(1, Number(limits.write || 1))) * 100)),
    delete: Number(today?.ratePercent?.delete ?? ((Number(today.delete || 0) / Math.max(1, Number(limits.delete || 1))) * 100))
  };
  const maxInRecent = {
    read: Math.max(1, ...recent.map((d) => Number(d.read || 0))),
    write: Math.max(1, ...recent.map((d) => Number(d.write || 0))),
    delete: Math.max(1, ...recent.map((d) => Number(d.delete || 0)))
  };
  const relativePercent = {
    read: (Number(today.read || 0) / Math.max(1, Number(maxInRecent.read || 1))) * 100,
    write: (Number(today.write || 0) / Math.max(1, Number(maxInRecent.write || 1))) * 100,
    delete: (Number(today.delete || 0) / Math.max(1, Number(maxInRecent.delete || 1))) * 100
  };
  return { today, ratePercent, relativePercent };
}

function buildUsageOverviewBody() {
  const fs = getFirestoreTodaySnapshot();
  const codexPrimary = state.codexUsageSummary?.primaryWindow || null;
  const codexSecondary = state.codexUsageSummary?.secondaryWindow || null;
  const fetchedAtISO = getUsageOverviewFetchedAtISO();
  const fsPerDay = Array.isArray(state.usageSummary?.perDay) ? state.usageSummary.perDay : [];
  const fs14Desc = [...fsPerDay]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);

  const lines = [
    `- fetched: ${formatDate(fetchedAtISO)}`,
    "",
    "## Codex",
    "",
    state.codexUsageSummary
      ? `- 5h remaining: ${boldPercent(codexPrimary?.remainingPercent, 0)} reset: ${resetDateText(codexPrimary)}`
      : `- status: ${state.codexUsageError ? `error (${state.codexUsageError})` : "loading"}`,
    state.codexUsageSummary
      ? `- weekly remaining: ${boldPercent(codexSecondary?.remainingPercent, 0)} reset: ${resetDateText(codexSecondary)}`
      : "- weekly remaining: -",
    "",
    "## Firestore",
    "",
    state.usageSummary
      ? `- free-tier: R ${boldPercent(fs.ratePercent.read, 1)} / W ${boldPercent(fs.ratePercent.write, 1)} / D ${boldPercent(fs.ratePercent.delete, 1)}`
      : `- status: ${state.usageError ? `error (${state.usageError})` : "loading"}`,
    state.usageSummary
      ? `- vs 14d max: R ${boldPercent(fs.relativePercent.read, 0)} / W ${boldPercent(fs.relativePercent.write, 0)} / D ${boldPercent(fs.relativePercent.delete, 0)}`
      : "- vs 14d max: -",
    "",
    "### Firestore 14d details",
    "",
    "| date (UTC) | read | write | delete | total |",
    "| --- | ---: | ---: | ---: | ---: |"
  ];

  for (const day of fs14Desc) {
    lines.push(`| ${day.date || "-"} | ${day.read || 0} | ${day.write || 0} | ${day.delete || 0} | ${day.total || 0} |`);
  }

  lines.push(...usageSourceFooterLines());
  return lines.join("\n");
}

function buildUsageOverviewPanelItem() {
  return {
    id: USAGE_OVERVIEW_PANEL_ID,
    projectName: "system",
    memoType: "keep",
    threadTitle: "Usage overview",
    memoBody: buildUsageOverviewBody(),
    createdAtISO: state.codexUsageSummary?.fetchedAtISO || state.usageSummary?.endTime || "",
    updatedAtISO: state.codexUsageSummary?.fetchedAtISO || state.usageSummary?.endTime || ""
  };
}

function buildUsageBody(summary) {
  if (!summary) {
    return [
      "# Firestore usage",
      "",
      "usage data is not loaded yet."
    ].concat(usageSourceFooterLines()).join("\n");
  }

  const perDayRaw = Array.isArray(summary.perDay) ? summary.perDay : [];
  const perDayDesc = [...perDayRaw].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const today = perDayDesc[0] || { date: "-", read: 0, write: 0, delete: 0, ratePercent: {} };
  const todayRate = {
    read: Number(today?.ratePercent?.read || 0),
    write: Number(today?.ratePercent?.write || 0),
    delete: Number(today?.ratePercent?.delete || 0)
  };
  const todayPeak = Math.max(todayRate.read, todayRate.write, todayRate.delete);

  const lines = [
    `# Firestore usage (${summary.projectId || "-"})`,
    "",
    `window: ${summary.startTime || "-"} .. ${summary.endTime || "-"} (${summary.windowHours || "-"}h)`,
    "",
    "## Totals",
    "",
    `- read: ${summary.totals?.read || 0} / ${summary.limitsDaily?.read || 0} (${boldPercent(summary.ratePercentOfDailyFreeTier?.read, 3)})`,
    `- write: ${summary.totals?.write || 0} / ${summary.limitsDaily?.write || 0} (${boldPercent(summary.ratePercentOfDailyFreeTier?.write, 3)})`,
    `- delete: ${summary.totals?.delete || 0} / ${summary.limitsDaily?.delete || 0} (${boldPercent(summary.ratePercentOfDailyFreeTier?.delete, 3)})`,
    "",
    "## Free-tier (today)",
    "",
    `- peak usage rate: ${boldPercent(todayPeak, 1)} (max of R/W/D)`,
    `- read: ${today.read || 0} / ${summary.limitsDaily?.read || 0} (${boldPercent(todayRate.read, 2)})`,
    `- write: ${today.write || 0} / ${summary.limitsDaily?.write || 0} (${boldPercent(todayRate.write, 2)})`,
    `- delete: ${today.delete || 0} / ${summary.limitsDaily?.delete || 0} (${boldPercent(todayRate.delete, 2)})`,
    "",
    "## Daily histogram source",
    "",
    "| date (UTC) | read | write | delete | total |",
    "| --- | ---: | ---: | ---: | ---: |"
  ];

  for (const day of perDayDesc) {
    lines.push(`| ${day.date} | ${day.read || 0} | ${day.write || 0} | ${day.delete || 0} | ${day.total || 0} |`);
  }

  if (summary.note) {
    lines.push("", summary.note);
  }

  lines.push(...usageSourceFooterLines());
  return lines.join("\n");
}

function buildUsagePanelItem() {
  return {
    id: USAGE_PANEL_ID,
    projectName: "system",
    memoType: "keep",
    threadTitle: "Firestore usage",
    memoBody: buildUsageBody(state.usageSummary),
    createdAtISO: state.usageSummary?.endTime || "",
    updatedAtISO: state.usageSummary?.endTime || ""
  };
}

function buildCodexUsageBody(summary) {
  if (!summary) {
    return [
      "# Codex usage",
      "",
      "usage data is not loaded yet."
    ].concat(usageSourceFooterLines()).join("\n");
  }

  const primary = summary.primaryWindow || null;
  const secondary = summary.secondaryWindow || null;
  const codeReview = summary.codeReviewWindow || null;

  return [
    `# Codex usage (${summary.planType || "-"})`,
    "",
    `fetched: ${summary.fetchedAtISO || "-"}`,
    `allowed: ${summary.allowed ? "yes" : "no"} / limit reached: ${summary.limitReached ? "yes" : "no"}`,
    "",
    "## Window (chat)",
    "",
    `- 5h window used: ${boldPercent(primary?.usedPercent, 1)} / remaining: ${boldPercent(primary?.remainingPercent, 1)}`,
    `- 5h reset: ${resetDateText(primary)}`,
    `- weekly window used: ${boldPercent(secondary?.usedPercent, 1)} / remaining: ${boldPercent(secondary?.remainingPercent, 1)}`,
    `- weekly reset: ${resetDateText(secondary)}`,
    "",
    "## Window (code review)",
    "",
    `- weekly window used: ${boldPercent(codeReview?.usedPercent, 1)} / remaining: ${boldPercent(codeReview?.remainingPercent, 1)}`,
    `- reset: ${resetDateText(codeReview)}`,
    "",
    "## Credits",
    "",
    `- has credits: ${summary.credits?.hasCredits ? "yes" : "no"} / unlimited: ${summary.credits?.unlimited ? "yes" : "no"}`,
    `- balance: ${summary.credits?.balance || "0"}`,
    `- approx local messages: ${(summary.credits?.approxLocalMessages || [0, 0]).join(" .. ")}`,
    `- approx cloud messages: ${(summary.credits?.approxCloudMessages || [0, 0]).join(" .. ")}`,
    ...usageSourceFooterLines()
  ].join("\n");
}

function buildCodexUsagePanelItem() {
  return {
    id: CODEX_USAGE_PANEL_ID,
    projectName: "system",
    memoType: "keep",
    threadTitle: "Codex usage",
    memoBody: buildCodexUsageBody(state.codexUsageSummary),
    createdAtISO: state.codexUsageSummary?.fetchedAtISO || "",
    updatedAtISO: state.codexUsageSummary?.fetchedAtISO || ""
  };
}

function renderDateWithCacheIndicator(value) {
  const formatted = formatDate(value);
  return state.selectedCacheHit ? `.${formatted}` : formatted;
}

function currentPayload() {
  return {
    projectName: el.projectNameInput.value.trim(),
    memoType: el.memoTypeInput.value,
    threadTitle: el.threadTitleInput.value.trim(),
    memoBody: el.memoBodyInput.value.trim()
  };
}

function currentEditorSnapshot() {
  return {
    projectName: el.projectNameInput.value,
    memoType: el.memoTypeInput.value,
    threadTitle: el.threadTitleInput.value,
    memoBody: el.memoBodyInput.value
  };
}

function hasRequiredPayloadFields() {
  return Boolean(
    el.projectNameInput.value.trim() &&
    el.threadTitleInput.value.trim() &&
    el.memoBodyInput.value.trim()
  );
}

function isSameSnapshot(a, b) {
  if (!a || !b) return false;
  return (
    a.projectName === b.projectName &&
    a.memoType === b.memoType &&
    a.threadTitle === b.threadTitle &&
    a.memoBody === b.memoBody
  );
}

function updateSaveButtonState() {
  if (isReadOnlyPanelSelected()) {
    el.saveBtn.disabled = true;
    return;
  }
  if (!hasRequiredPayloadFields()) {
    el.saveBtn.disabled = true;
    return;
  }
  const dirty = !isSameSnapshot(currentEditorSnapshot(), state.editorBaseline);
  el.saveBtn.disabled = !dirty;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const LOCAL_PATH_REGEX = /(?:\/Users|\/tmp|\/var)\/[^\s"'`<>:]+(?::\d+(?:-\d+)?(?:[,\s]+\d+(?:-\d+)?)*)?/gi;
const LOCAL_PATH_TOKEN_REGEX = /^\/(?:Users|tmp|var)\/[^\s"'`<>:]+(?::\d+(?:-\d+)?(?:[,\s]+\d+(?:-\d+)?)*)?$/i;

function extractLinks(text) {
  const source = String(text || "");
  const markdownLinkRegex = /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g;
  const bareUrlRegex = /\bhttps?:\/\/[^\s<>()]+/g;
  const links = [];
  const seen = new Set();
  let stripped = source;

  stripped = stripped.replace(markdownLinkRegex, (_, url) => {
    const cleaned = String(url || "").trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      links.push(cleaned);
    }
    return " ";
  });

  let match = bareUrlRegex.exec(stripped);
  while (match) {
    const cleaned = String(match[0] || "").trim().replace(/[),.;!?]+$/, "");
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      links.push(cleaned);
    }
    match = bareUrlRegex.exec(stripped);
  }
  return links;
}

function extractLocalPaths(text) {
  const source = String(text || "");
  const paths = [];
  const seen = new Set();
  LOCAL_PATH_REGEX.lastIndex = 0;
  let match = LOCAL_PATH_REGEX.exec(source);
  while (match) {
    const cleaned = normalizePathToken(String(match[0] || "").trim());
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      paths.push(cleaned);
    }
    match = LOCAL_PATH_REGEX.exec(source);
  }
  return paths;
}

function hasBodyLink(text) {
  return extractLinks(text).length > 0 || extractLocalPaths(text).length > 0;
}

function normalizePathToken(raw) {
  return String(raw || "").replace(/^[("'`[\{<]+/, "").replace(/[)"'`\]}>.,;!?]+$/, "").trim();
}

function stripPathLocationSuffix(value) {
  return String(value || "")
    .replace(/:(?:\d+(?:-\d+)?)(?:[,\s]+\d+(?:-\d+)?)*\s*$/, "")
    .trim();
}

function splitPathAndLocation(value) {
  const token = String(value || "").trim();
  const base = stripPathLocationSuffix(token);
  if (!token.startsWith(base)) {
    return { base: token, location: "" };
  }
  return { base, location: token.slice(base.length) };
}

function isLocalPathToken(value) {
  return LOCAL_PATH_TOKEN_REGEX.test(String(value || "").trim());
}

function tokenAtCursor(text, cursorIndex) {
  const source = String(text || "");
  const index = Math.max(0, Math.min(source.length, Number(cursorIndex) || 0));
  let start = index;
  let end = index;
  while (start > 0 && !/\s/.test(source[start - 1])) start -= 1;
  while (end < source.length && !/\s/.test(source[end])) end += 1;
  return normalizePathToken(source.slice(start, end));
}

async function openLocalPath(localPath) {
  const requested = normalizePathToken(localPath);
  const normalized = stripPathLocationSuffix(requested);
  const data = await request("/api/open-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: normalized, originalPath: requested })
  });
  setStatus(`Opened: ${data.openedPath || data.path || normalized}`, false, "force");
}

async function tryOpenPathAtCursor() {
  const token = tokenAtCursor(el.memoBodyInput.value || "", el.memoBodyInput.selectionStart || 0);
  if (!isLocalPathToken(token)) return false;
  await openLocalPath(token);
  return true;
}

function linkifyLocalPathsInPreview(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  let node = walker.nextNode();
  while (node) {
    const parentName = node.parentElement ? node.parentElement.tagName : "";
    if (
      node.nodeValue &&
      /\/(?:Users|tmp|var)\//.test(node.nodeValue) &&
      !["A", "CODE", "PRE", "SCRIPT", "STYLE"].includes(parentName)
    ) {
      targets.push(node);
    }
    node = walker.nextNode();
  }

  for (const textNode of targets) {
    const source = String(textNode.nodeValue || "");
    LOCAL_PATH_REGEX.lastIndex = 0;
    const matches = [...source.matchAll(LOCAL_PATH_REGEX)];
    if (!matches.length) continue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of matches) {
      const start = Number(m.index || 0);
      const raw = String(m[0] || "");
      if (start > cursor) {
        frag.appendChild(document.createTextNode(source.slice(cursor, start)));
      }
      const pathToken = normalizePathToken(raw);
      if (isLocalPathToken(pathToken)) {
        const { base: openPath, location } = splitPathAndLocation(pathToken);
        const a = document.createElement("a");
        a.href = "#";
        a.className = "local-path-link";
        a.dataset.localPath = openPath;
        a.title = `Open local file: ${openPath}`;
        a.textContent = openPath;
        frag.appendChild(a);
        if (location) {
          frag.appendChild(document.createTextNode(location));
        }
      } else {
        frag.appendChild(document.createTextNode(raw));
      }
      cursor = start + raw.length;
    }
    if (cursor < source.length) {
      frag.appendChild(document.createTextNode(source.slice(cursor)));
    }
    textNode.replaceWith(frag);
  }
}

function annotateUsageRefLinks(root) {
  if (!root) return;
  root.querySelectorAll("a").forEach((anchor) => {
    const href = String(anchor.getAttribute("href") || "").trim();
    if (href === FIREBASE_USAGE_PAGE_URL || href === CODEX_USAGE_PAGE_URL) {
      anchor.classList.add("usage-ref-link");
    }
  });
}

function openUsageRefs() {
  window.open(FIREBASE_USAGE_PAGE_URL, "_blank", "noopener,noreferrer");
  window.open(CODEX_USAGE_PAGE_URL, "_blank", "noopener,noreferrer");
}

function renderMarkdownPreview() {
  const source = el.memoBodyInput.value || "";
  let html = "";
  const markedLib = window.marked;
  if (markedLib) {
    if (typeof markedLib.parse === "function") {
      html = markedLib.parse(source, { gfm: true, breaks: true });
    } else if (typeof markedLib === "function") {
      html = markedLib(source, { gfm: true, breaks: true });
    }
  } else {
    html = `<pre>${escapeHtml(source)}</pre>`;
  }
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
    html = window.DOMPurify.sanitize(html);
  }
  el.memoPreview.innerHTML = html || "<p></p>";
  linkifyLocalPathsInPreview(el.memoPreview);
  annotateUsageRefLinks(el.memoPreview);
  el.memoPreview.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });

  const preview = el.memoPreview;
  preview.querySelectorAll("h1,h2,h3").forEach((n) => {
    n.style.fontWeight = "700";
    n.style.margin = "0.35em 0";
  });
  preview.querySelectorAll("h1").forEach((n) => { n.style.fontSize = "1.2em"; });
  preview.querySelectorAll("h2").forEach((n) => { n.style.fontSize = "1.1em"; });
  preview.querySelectorAll("h3").forEach((n) => { n.style.fontSize = "1.0em"; });
  preview.querySelectorAll("p").forEach((n) => { n.style.margin = "0.25em 0"; });
  preview.querySelectorAll("ul,ol").forEach((n) => {
    n.style.margin = "0.25em 0";
    n.style.paddingLeft = "1.25em";
  });
  // Keep one visible blank-line feel before closing messages after bullet lists.
  preview.querySelectorAll("ul + p, ol + p").forEach((n) => {
    n.style.marginTop = "0.9em";
  });
  preview.querySelectorAll("code").forEach((n) => {
    n.style.background = "#e5e7eb";
    n.style.borderRadius = "4px";
    n.style.padding = "0 4px";
  });
  preview.querySelectorAll("pre").forEach((n) => {
    n.style.background = "#e5e7eb";
    n.style.borderRadius = "8px";
    n.style.padding = "8px";
    n.style.overflow = "auto";
  });
}

function getBodyMode() {
  const mode = el.bodyModeToggle?.dataset?.mode;
  return mode === "text" ? "text" : "preview";
}

function setBodyMode(mode) {
  const next = mode === "text" ? "text" : "preview";
  el.bodyModeToggle.dataset.mode = next;
  if (next === "preview") {
    el.bodyModeToggle.innerHTML = [
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8">',
      '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path>',
      '<circle cx="12" cy="12" r="2.5"></circle>',
      "</svg>"
    ].join("");
    el.bodyModeToggle.setAttribute("title", "Preview mode");
    el.bodyModeToggle.setAttribute("aria-label", "Switch to text mode");
  } else {
    el.bodyModeToggle.innerHTML = [
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8">',
      '<path d="M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4Z"></path>',
      '<path d="M13.5 6.5l4 4"></path>',
      "</svg>"
    ].join("");
    el.bodyModeToggle.setAttribute("title", "Text mode");
    el.bodyModeToggle.setAttribute("aria-label", "Switch to preview mode");
  }
  el.bodyModeToggle.setAttribute("aria-pressed", String(next === "preview"));
  el.bodyModeToggle.classList.remove(
    "border-[#d4d8e0]",
    "bg-[#fefdfb]",
    "text-[#4b5568]",
    "border-[#5f8a5f]",
    "bg-[#5f8a5f]",
    "text-[#f3fff3]"
  );
  if (next === "preview") {
    el.bodyModeToggle.classList.add("border-[#5f8a5f]", "bg-[#5f8a5f]", "text-[#f3fff3]");
  } else {
    el.bodyModeToggle.classList.add("border-[#d4d8e0]", "bg-[#fefdfb]", "text-[#4b5568]");
  }
}

function updateBodyMode() {
  const preview = getBodyMode() === "preview";
  el.memoBodyInput.classList.toggle("hidden", preview);
  el.memoPreview.classList.toggle("hidden", !preview);
  if (preview) {
    renderMarkdownPreview();
  }
}

function sortMemosForList(items) {
  return [...items].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    const ta = new Date(a.datetimeISO || a.createdAtISO || 0).getTime();
    const tb = new Date(b.datetimeISO || b.createdAtISO || 0).getTime();
    return tb - ta;
  });
}

function listItemsForView() {
  if (!state.showOnlyDeletable) {
    return state.items;
  }
  return state.items.filter((item) => Boolean(item.deletable));
}

function getVisibleItemsSorted() {
  return sortMemosForList(listItemsForView());
}

function parseIsoToMs(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function shouldRefreshByAge(fetchedAtISO, intervalMs) {
  const fetchedAtMs = parseIsoToMs(fetchedAtISO);
  if (!Number.isFinite(fetchedAtMs)) return true;
  return (Date.now() - fetchedAtMs) >= Math.max(1, Number(intervalMs || 0));
}

function shouldRefreshUsage(options = {}) {
  const forceReload = Boolean(options.forceReload);
  if (forceReload) {
    return { refreshFirestore: true, refreshCodex: true };
  }
  return {
    refreshFirestore: shouldRefreshByAge(state.usageFetchedAtISO, FIRESTORE_USAGE_REFRESH_INTERVAL_MS),
    refreshCodex: shouldRefreshByAge(state.codexUsageFetchedAtISO, CODEX_USAGE_REFRESH_INTERVAL_MS)
  };
}

function refreshUsageIfNeeded(options = {}) {
  if (state.usageTileCollapsed) {
    return Promise.resolve();
  }
  const { refreshFirestore, refreshCodex } = shouldRefreshUsage(options);
  const forceReload = Boolean(options.forceReload);

  if (!refreshFirestore && !refreshCodex) {
    return Promise.resolve();
  }
  if (!forceReload && usageRefreshInFlight) {
    return usageRefreshInFlight;
  }

  const jobs = [];
  if (refreshFirestore) jobs.push(loadUsageSummary({ forceReload }));
  if (refreshCodex) jobs.push(loadCodexUsageSummary({ forceReload }));

  usageRefreshInFlight = Promise.all(jobs)
    .finally(() => {
      usageRefreshInFlight = null;
      if (state.selectedId === USAGE_OVERVIEW_PANEL_ID) {
        fillEditor(buildUsageOverviewPanelItem(), { fromCache: false });
        return;
      }
      if (state.selectedId === USAGE_PANEL_ID) {
        fillEditor(buildUsagePanelItem(), { fromCache: false });
        return;
      }
      if (state.selectedId === CODEX_USAGE_PANEL_ID) {
        fillEditor(buildCodexUsagePanelItem(), { fromCache: false });
        return;
      }
      renderList();
    });

  return usageRefreshInFlight;
}

function syncDeleteButtonLabel() {
  el.deleteBtn.textContent = state.showOnlyDeletable ? "ALL" : "Delete";
}

function memoTypeBadgeClass(memoType) {
  switch (memoType) {
    case "memo":
      return "border-[#d2d6de] bg-[#f3f5f8] text-[#5f6674]";
    case "handover memo":
      return "border-[#e5c6a0] bg-[#f9efe2] text-[#9a6330]";
    case "keep":
      return "border-[#9fcca0] bg-[#e9f5e9] text-[#4e7a4e]";
    case "propomemo":
      return "border-[#d8c0a5] bg-[#f6ecdf] text-[#8c6a43]";
    default:
      return "border-[#d7dce7] bg-[#f3f5fa] text-[#66738f]";
  }
}

function displayMemoTypeLabel(memoType) {
  if (memoType === "handover memo") return "handover";
  return memoType || "memo";
}

async function loadUsageSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams({
    hours: String(USAGE_PANEL_HOURS)
  });
  if (forceReload) {
    params.set("nocache", "1");
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/firestore?${params.toString()}`,
    controller ? { signal: controller.signal } : undefined
  );
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Timed out (${USAGE_FETCH_TIMEOUT_MS}ms)`));
    }, USAGE_FETCH_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    state.usageSummary = body;
    state.usageError = "";
    state.usageFetchedAtISO = new Date().toISOString();
  } catch (error) {
    state.usageSummary = null;
    state.usageError = error.message || "Failed to load usage";
    state.usageFetchedAtISO = "";
  }
}

async function loadCodexUsageSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams();
  if (forceReload) params.set("nocache", "1");

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/codex?${params.toString()}`,
    controller ? { signal: controller.signal } : undefined
  );
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Timed out (${USAGE_FETCH_TIMEOUT_MS}ms)`));
    }, USAGE_FETCH_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    state.codexUsageSummary = body;
    state.codexUsageError = "";
    state.codexUsageFetchedAtISO = new Date().toISOString();
  } catch (error) {
    state.codexUsageSummary = null;
    state.codexUsageError = error.message || "Failed to load codex usage";
    state.codexUsageFetchedAtISO = "";
  }
}

function renderList() {
  el.memoList.innerHTML = "";
  const items = sortMemosForList(listItemsForView());

  const usageLi = document.createElement("li");
  usageLi.className = [
    "group",
    "relative",
    "cursor-pointer",
    "-mt-1",
    "mb-2.5",
    "px-0.5",
    "py-0.5",
    "transition-opacity",
    "hover:opacity-95"
  ].join(" ");

  const fsSnapshot = getFirestoreTodaySnapshot();
  const fsPeak = Math.max(fsSnapshot.ratePercent.read, fsSnapshot.ratePercent.write, fsSnapshot.ratePercent.delete);
  const codexPrimary = state.codexUsageSummary?.primaryWindow || null;
  const codexSecondary = state.codexUsageSummary?.secondaryWindow || null;
  const usageActive = isUsageOverviewPanelSelected();

  const row = document.createElement("div");
  row.className = "grid grid-cols-2 gap-1.5";

  const left = document.createElement("div");
  left.className = "rounded-md border border-[#4b5563] bg-[#4b5563] px-2 py-1";
  left.addEventListener("click", (ev) => {
    if (!ev.shiftKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    window.open(FIREBASE_USAGE_PAGE_URL, "_blank", "noopener,noreferrer");
  });
  const leftTop = document.createElement("div");
  leftTop.className = "flex items-center justify-between gap-1";
  const leftTitle = document.createElement("strong");
  leftTitle.className = "block text-[12px] leading-4 text-[#f9fafb]";
  leftTitle.textContent = "Firebase";
  const fsBadge = document.createElement("span");
  fsBadge.className = "inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold leading-none";
  fsBadge.classList.add("border", "bg-[#ffffff]", "text-[#374151]");
  applyPressureBadgeBorder(fsBadge, fsPeak);
  fsBadge.textContent = state.usageSummary ? `${fsPeak.toFixed(1)}%` : "-";
  leftTop.appendChild(leftTitle);
  leftTop.appendChild(fsBadge);

  const fsMini = document.createElement("div");
  fsMini.className = "mt-0.5 flex h-6 items-end gap-1";
  const fsBarDefs = [
    { key: "read", color: "bg-[#6f86ac]", bg: "bg-[#d7deeb]" },
    { key: "write", color: "bg-[#d59d4f]", bg: "bg-[#eee1c8]" },
    { key: "delete", color: "bg-[#cf7896]", bg: "bg-[#edd4df]" }
  ];
  for (const def of fsBarDefs) {
    const track = document.createElement("span");
    track.className = `relative h-full w-[8px] overflow-hidden rounded-[3px] ${def.bg}`;
    const fill = document.createElement("span");
    fill.className = `absolute bottom-0 left-0 right-0 ${def.color}`;
    const h = state.usageSummary ? Math.max(2, Math.min(100, Number(fsSnapshot.relativePercent[def.key] || 0))) : 2;
    fill.style.height = `${h}%`;
    track.title = state.usageSummary
      ? `${def.key}: ${fsSnapshot.today[def.key] || 0} / free-tier ${formatPercent(fsSnapshot.ratePercent[def.key], 2)} / 14d比 ${formatPercent(fsSnapshot.relativePercent[def.key], 1)}`
      : "loading";
    track.appendChild(fill);
    fsMini.appendChild(track);
  }

  const fsSummaryText = state.usageSummary
    ? `R: ${fsSnapshot.today.read || 0} / W: ${fsSnapshot.today.write || 0} / D: ${fsSnapshot.today.delete || 0}`
    : (state.usageError ? "error" : "loading...");
  const leftMain = document.createElement("div");
  leftMain.className = "mt-0.5 text-[10px] leading-3.5 text-[#e5e7eb]";
  leftMain.textContent = fsSummaryText;
  left.appendChild(leftTop);
  left.appendChild(fsMini);
  left.appendChild(leftMain);

  const right = document.createElement("div");
  right.className = "rounded-md border border-[#4b5563] bg-[#4b5563] px-2 py-1";
  right.addEventListener("click", (ev) => {
    if (!ev.shiftKey) return;
    ev.preventDefault();
    ev.stopPropagation();
    window.open(CODEX_USAGE_PAGE_URL, "_blank", "noopener,noreferrer");
  });
  const rightTop = document.createElement("div");
  rightTop.className = "flex items-center justify-between gap-1";
  const rightTitle = document.createElement("strong");
  rightTitle.className = "block text-[12px] leading-4 text-[#f9fafb]";
  rightTitle.textContent = "Codex";
  const codexBadge = document.createElement("span");
  codexBadge.className = "inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold leading-none border bg-[#ffffff] text-[#374151]";
  applyPressureBadgeBorder(codexBadge, 100 - Number(codexSecondary?.remainingPercent || 0));
  codexBadge.textContent = state.codexUsageSummary ? `${formatPercent(codexSecondary?.remainingPercent, 0)}` : "-";
  rightTop.appendChild(rightTitle);
  rightTop.appendChild(codexBadge);
  const codexBars = document.createElement("div");
  codexBars.className = "mt-0.5 space-y-0.5";
  const codexDefs = [
    { label: "5h", value: Number(codexPrimary?.remainingPercent || 0), color: "bg-[#b88f55]", bg: "bg-[#efdfc7]" },
    { label: "1w", value: Number(codexSecondary?.remainingPercent || 0), color: "bg-[#7a9f7a]", bg: "bg-[#ddebd9]" }
  ];
  for (const def of codexDefs) {
    const rowBar = document.createElement("div");
    rowBar.className = "flex items-center gap-1";
    const label = document.createElement("span");
    label.className = "w-5 text-[10px] leading-3 text-[#e5e7eb]";
    label.textContent = def.label;
    const track = document.createElement("span");
    track.className = `relative block h-[7px] flex-1 overflow-hidden rounded ${def.bg}`;
    const fill = document.createElement("span");
    fill.className = `absolute bottom-0 left-0 top-0 ${def.color}`;
    fill.style.width = `${state.codexUsageSummary ? Math.max(2, Math.min(100, def.value)) : 2}%`;
    track.appendChild(fill);
    rowBar.appendChild(label);
    rowBar.appendChild(track);
    codexBars.appendChild(rowBar);
  }
  const codexSummaryText = state.codexUsageSummary
    ? `5h: ${formatPercent(codexPrimary?.remainingPercent, 0)} 1w: ${formatPercent(codexSecondary?.remainingPercent, 0)}`
    : (state.codexUsageError ? "error" : "loading...");
  const rightMain = document.createElement("div");
  rightMain.className = "mt-0.5 text-[10px] leading-3.5 text-[#e5e7eb]";
  rightMain.textContent = codexSummaryText;
  right.appendChild(rightTop);
  right.appendChild(codexBars);
  right.appendChild(rightMain);

  row.appendChild(left);
  row.appendChild(right);
  const usageTop = document.createElement("div");
  usageTop.className = state.usageTileCollapsed
    ? "mb-1 flex cursor-pointer items-center justify-between rounded-md border border-[#4b5563] bg-[#4b5563] px-2 py-1"
    : usageActive
      ? "mb-1 flex cursor-pointer items-center justify-between rounded-md border border-[#ddd5c8] bg-[#fefdfb] px-2 py-1"
      : "mb-1 flex cursor-pointer items-center justify-between px-1";
  const usageLabel = document.createElement("span");
  usageLabel.className = state.usageTileCollapsed
    ? "hidden"
    : "text-[10px] font-semibold tracking-wide text-[#7c869a]";
  usageLabel.textContent = state.usageTileCollapsed ? "" : "usage";
  const collapseIcon = document.createElement("span");
  collapseIcon.className = state.usageTileCollapsed
    ? "inline-flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-[#e5e7eb]"
    : "inline-flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-[#7c869a]";
  collapseIcon.textContent = state.usageTileCollapsed ? ">" : "v";
  usageTop.setAttribute("aria-label", state.usageTileCollapsed ? "Expand usage tile" : "Collapse usage tile");
  usageTop.title = state.usageTileCollapsed ? "Expand usage tile" : "Collapse usage tile";
  usageTop.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    state.usageTileCollapsed = !state.usageTileCollapsed;
    renderList();
    if (!state.usageTileCollapsed) {
      refreshUsageIfNeeded().catch(() => {});
    }
  });
  usageTop.appendChild(usageLabel);
  if (state.usageTileCollapsed) {
    const collapsedSummary = document.createElement("div");
    collapsedSummary.className = "mx-2 flex min-w-0 flex-1 items-center gap-5 text-[11px] leading-4 text-[#e5e7eb]";
    const fsLine = document.createElement("span");
    fsLine.className = "min-w-0 shrink truncate";
    fsLine.textContent = fsSummaryText;
    const codexLine = document.createElement("span");
    codexLine.className = "min-w-0 shrink truncate";
    codexLine.textContent = codexSummaryText;
    collapsedSummary.appendChild(fsLine);
    collapsedSummary.appendChild(codexLine);
    usageTop.appendChild(collapsedSummary);
  }
  usageTop.appendChild(collapseIcon);
  usageLi.appendChild(usageTop);
  if (!state.usageTileCollapsed) {
    usageLi.appendChild(row);
  }
  usageLi.title = `Firebase: ${formatDate(state.usageFetchedAtISO || state.usageSummary?.endTime)} | Codex: ${formatDate(state.codexUsageFetchedAtISO || state.codexUsageSummary?.fetchedAtISO)}`;
  usageLi.addEventListener("click", () => fillEditor(buildUsageOverviewPanelItem(), { fromCache: false }));
  el.memoList.appendChild(usageLi);

  for (const item of items) {
    const li = document.createElement("li");
    const isActive = item.id === state.selectedId;
    const isPinned = Boolean(item.pinned);
    const isDeletable = Boolean(item.deletable);
    const pinBlocked = !isPinned && isDeletable;
    const delBlocked = !isDeletable && isPinned;
    li.className = [
      "group",
      "relative",
      "cursor-pointer",
      "rounded-lg",
      "border",
      "px-2.5",
      "py-2",
      "transition-colors",
      "hover:bg-[#e7e1d7]",
      isActive
        ? "border-[#ddd5c8] bg-[#fefdfb]"
        : isPinned
          ? "border-[#9aabc9] bg-[#f9f6f0]"
          : "border-[#e5ddd2] bg-[#f9f6f0]"
    ].join(" ");

    const topRow = document.createElement("div");
    topRow.className = "flex items-center gap-1";

    const title = document.createElement("strong");
    title.className = "block text-[13px] leading-4 text-[#4f5f7e]";
    title.textContent = item.threadTitle || "(no title)";

    topRow.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "mt-0.5 flex min-w-0 items-center gap-1 pr-8";
    const typeBadge = document.createElement("span");
    typeBadge.className = [
      "inline-flex",
      "h-3.5",
      "shrink-0",
      "items-center",
      "rounded-md",
      "border",
      "px-1",
      "text-[9px]",
      "font-semibold",
      "leading-none",
      memoTypeBadgeClass(item.memoType)
    ].join(" ");
    typeBadge.textContent = displayMemoTypeLabel(item.memoType);
    const metaText = document.createElement("small");
    metaText.className = "block min-w-0 truncate whitespace-nowrap text-[9px] leading-3.5 text-[#78829a]";
    metaText.textContent = `${item.projectName}`;
    const dateText = document.createElement("small");
    dateText.className = "shrink-0 whitespace-nowrap text-[9px] leading-3.5 text-[#7f8aa3]";
    dateText.textContent = formatDate(item.datetimeISO || item.createdAtISO);
    meta.appendChild(typeBadge);
    meta.appendChild(metaText);
    meta.appendChild(dateText);

    if (hasBodyLink(item.memoBody || "")) {
      const linkBadge = document.createElement("span");
      linkBadge.className = "inline-flex h-3.5 shrink-0 items-center rounded border border-[#d6dce8] px-1 text-[8px] font-medium leading-none text-[#7a859e]";
      linkBadge.textContent = "link";
      linkBadge.title = "Body contains link/path";
      meta.appendChild(linkBadge);
    }

    li.appendChild(topRow);
    li.appendChild(meta);

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.tabIndex = -1;
    pinBtn.className = [
      "absolute",
      "right-1",
      "top-1/2",
      "-translate-y-[14px]",
      "h-4",
      "w-4",
      "flex",
      "items-center",
      "justify-center",
      isPinned
        ? "text-[#2563eb]"
        : "text-[#94a3b8] hover:text-[#0ea5ff] focus-visible:text-[#0ea5ff]",
      isPinned
        ? "opacity-100 pointer-events-auto"
        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
      "transition-opacity",
      pinBlocked ? "opacity-40 cursor-not-allowed" : ""
    ].join(" ");
    const pinIconClass = isPinned
      ? "h-full w-full stroke-current transition-colors"
      : "h-full w-full fill-none stroke-current transition-colors";
    pinBtn.innerHTML = [
      `<svg viewBox="0 0 24 24" aria-hidden="true" class="${pinIconClass}">`,
      isPinned
        ? '<path d="M9 4h6l-1.2 4.2 3.2 3.3V13H7v-1.5l3.2-3.3L9 4Z" fill="currentColor"></path>'
        : '<path d="M9 4h6l-1.2 4.2 3.2 3.3V13H7v-1.5l3.2-3.3L9 4Z" stroke-width="1.7" stroke-linejoin="round"></path>',
      '<path d="M12 13v7" stroke-width="1.7" stroke-linecap="round"></path>',
      "</svg>"
    ].join("");
    pinBtn.title = pinBlocked ? "Pin is disabled while DEL is on" : (isPinned ? "Unpin" : "Pin");
    pinBtn.setAttribute("aria-label", pinBlocked ? "Pin disabled" : (isPinned ? "Unpin" : "Pin"));
    pinBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (pinBlocked) {
        setStatus("Cannot turn PIN on while DEL is on", true);
        return;
      }
      await togglePin(item);
    });
    if (!isDeletable) {
      li.appendChild(pinBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.tabIndex = -1;
    delBtn.className = [
      "absolute",
      "right-1",
      "top-1/2",
      "translate-y-[7px]",
      "h-4",
      "w-4",
      "flex",
      "items-center",
      "justify-center",
      "leading-none",
      isDeletable
        ? "text-[#ff2d55]"
        : "text-[#8e97ab] hover:text-[#ff4d8d] focus-visible:text-[#ff4d8d]",
      isDeletable
        ? "opacity-100 pointer-events-auto"
        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
      "transition-opacity",
      delBlocked ? "opacity-40 cursor-not-allowed" : ""
    ].join(" ");
    const delIconClass = "h-full w-full stroke-current transition-colors";
    delBtn.innerHTML = [
      `<svg viewBox="0 0 24 24" aria-hidden="true" class="${delIconClass}" stroke-width="1.7">`,
      '<path d="M5 7h14" stroke-linecap="round"></path>',
      '<path d="M9 7V5h6v2" stroke-linecap="round" stroke-linejoin="round"></path>',
      '<rect x="7" y="7" width="10" height="12" rx="1.5" fill="none"></rect>',
      '<path d="M10 10.5v5.5M14 10.5v5.5" stroke-linecap="round"></path>',
      "</svg>"
    ].join("");
    delBtn.title = delBlocked ? "DEL is disabled while PIN is on" : (isDeletable ? "Unset deletable" : "Set deletable");
    delBtn.setAttribute("aria-label", delBlocked ? "DEL disabled" : (isDeletable ? "Unset deletable" : "Set deletable"));
    delBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (delBlocked) {
        setStatus("Cannot turn DEL on while PIN is on", true);
        return;
      }
      await toggleDeletable(item);
    });
    if (!isPinned) {
      li.appendChild(delBtn);
    }

    li.addEventListener("click", () => loadMemo(item.id));
    el.memoList.appendChild(li);
  }
}

function fillEditor(item, options = {}) {
  const isOverviewPanel = item && item.id === USAGE_OVERVIEW_PANEL_ID;
  const isUsagePanel = item && item.id === USAGE_PANEL_ID;
  const isCodexPanel = item && item.id === CODEX_USAGE_PANEL_ID;
  const isReadOnlyPanel = Boolean(isOverviewPanel || isUsagePanel || isCodexPanel);
  state.selectedId = item && item.id ? item.id : null;
  state.selectedCacheHit = Boolean(options.fromCache);
  el.projectNameInput.value = item?.projectName || "";
  el.memoTypeInput.value = item?.memoType || "memo";
  el.threadTitleInput.value = item?.threadTitle || "";
  el.memoBodyInput.value = item?.memoBody || "";
  el.dateText.textContent = isUsagePanel
    ? formatDate(state.usageFetchedAtISO || state.usageSummary?.endTime)
    : isOverviewPanel
      ? formatDate(state.codexUsageFetchedAtISO || state.usageFetchedAtISO || item?.updatedAtISO)
    : isCodexPanel
      ? formatDate(state.codexUsageFetchedAtISO || state.codexUsageSummary?.fetchedAtISO)
      : renderDateWithCacheIndicator(item?.updatedAtISO || item?.createdAtISO || item?.datetimeISO);
  el.projectNameInput.readOnly = isReadOnlyPanel;
  el.threadTitleInput.readOnly = isReadOnlyPanel;
  el.memoBodyInput.readOnly = isReadOnlyPanel;
  el.memoTypeInput.disabled = isReadOnlyPanel;
  state.editorBaseline = isReadOnlyPanel ? null : currentEditorSnapshot();
  updateSaveButtonState();
  el.deleteBtn.disabled = isReadOnlyPanel;
  // Export actions are allowed for usage panels as read-only snapshots.
  el.downloadFormatSelect.disabled = false;
  el.downloadBtn.disabled = false;
  el.shareBtn.disabled = false;
  syncDeleteButtonLabel();
  el.deleteBtn.title = isReadOnlyPanel
    ? "Delete is disabled in usage panel"
    : state.showOnlyDeletable
      ? "ALL: delete all deletable docs (Shift: filter off)"
      : "ALL: delete all deletable docs (Shift: filter on)";
  if (!el.bodyModeToggle.dataset.mode) {
    setBodyMode("preview");
  }
  updateBodyMode();
  renderList();
  setStatus(isReadOnlyPanel ? "Usage detail view" : "");
}

function applyUpdatedMemo(updated) {
  state.items = state.items.map((memo) => (memo.id === updated.id ? updated : memo));
  if (state.selectedId === updated.id) {
    fillEditor(updated, { fromCache: false });
  } else {
    renderList();
  }
}

async function togglePin(item) {
  const nextPinned = !Boolean(item.pinned);

  try {
    const data = await request(`/api/memos/${encodeURIComponent(item.id)}/pin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: nextPinned })
    });
    applyUpdatedMemo(data.item);
    setStatus(data.item.pinned ? `Pinned: ${data.item.id}` : `Unpinned: ${data.item.id}`);
  } catch (error) {
    if (!String(error.message).includes("HTTP 404")) {
      setStatus(`Pin update error: ${error.message}`, true);
      return;
    }

    // Backward compatibility: old server without PATCH /pin route.
    try {
      const fallback = await request(`/api/memos/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: item.projectName || "",
          memoType: item.memoType || "memo",
          threadTitle: item.threadTitle || "(no title)",
          memoBody: item.memoBody || " ",
          deletable: Boolean(item.deletable),
          pinned: nextPinned
        })
      });
      applyUpdatedMemo(fallback.item);
      setStatus("Pin updated via fallback route");
    } catch (fallbackError) {
      setStatus(`Pin update error: ${fallbackError.message}`, true);
    }
  }
}

async function toggleDeletable(item) {
  const nextDeletable = !Boolean(item.deletable);
  try {
    const data = await request(`/api/memos/${encodeURIComponent(item.id)}/deletable`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deletable: nextDeletable })
    });
    applyUpdatedMemo(data.item);
    setStatus(data.item.deletable ? `Deletable: ${data.item.id}` : `Deletable off: ${data.item.id}`, false, "danger");
  } catch (error) {
    if (!String(error.message).includes("HTTP 404")) {
      setStatus(`Del update error: ${error.message}`, true);
      return;
    }

    // Backward compatibility: old server without PATCH /deletable route.
    try {
      const fallback = await request(`/api/memos/${encodeURIComponent(item.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: item.projectName || "",
          memoType: item.memoType || "memo",
          threadTitle: item.threadTitle || "(no title)",
          memoBody: item.memoBody || " ",
          deletable: nextDeletable,
          pinned: Boolean(item.pinned)
        })
      });
      applyUpdatedMemo(fallback.item);
      setStatus("Del updated via fallback route", false, "danger");
    } catch (fallbackError) {
      setStatus(`Del update error: ${fallbackError.message}`, true);
    }
  }
}

async function loadMemos(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const usageJob = refreshUsageIfNeeded({ forceReload });

  try {
    const selectFirst = Boolean(options.selectFirst);
    const params = new URLSearchParams();
    if (el.qInput.value.trim()) params.set("q", el.qInput.value.trim());
    if (el.projectInput.value.trim()) params.set("projectName", el.projectInput.value.trim());
    if (el.typeSelect.value) params.set("memoType", el.typeSelect.value);
    params.set("limit", "300");
    if (forceReload) params.set("nocache", "1");

    const data = await request(`/api/memos?${params.toString()}`);
    state.items = data.items || [];
    const listFromCache = state.lastResponseCacheHit;
    const visibleItems = getVisibleItemsSorted();
    if (selectFirst && visibleItems.length > 0) {
      fillEditor(visibleItems[0], { fromCache: listFromCache });
      state.hasInitialAutoSelection = true;
      return usageJob;
    }
    if (!state.selectedId && !state.hasInitialAutoSelection) {
      fillEditor(buildUsageOverviewPanelItem(), { fromCache: false });
      state.hasInitialAutoSelection = true;
      return usageJob;
    }
    if (state.selectedId && !isSpecialPanelId(state.selectedId) && !state.items.some((memo) => memo.id === state.selectedId)) {
      state.selectedId = null;
    }
    if (
      !isSpecialPanelId(state.selectedId) &&
      state.showOnlyDeletable &&
      state.selectedId &&
      !visibleItems.some((memo) => memo.id === state.selectedId)
    ) {
      if (visibleItems.length > 0) {
        fillEditor(visibleItems[0], { fromCache: listFromCache });
      } else {
        fillEditor(null);
      }
      return usageJob;
    }
    if (state.selectedId === USAGE_OVERVIEW_PANEL_ID) {
      fillEditor(buildUsageOverviewPanelItem(), { fromCache: false });
    } else if (state.selectedId === USAGE_PANEL_ID) {
      fillEditor(buildUsagePanelItem(), { fromCache: false });
    } else if (state.selectedId === CODEX_USAGE_PANEL_ID) {
      fillEditor(buildCodexUsagePanelItem(), { fromCache: false });
    } else {
      renderList();
    }

    return usageJob;
  } catch (error) {
    setStatus(`Load error: ${error.message}`, true);
    await usageJob;
  }
}

async function loadMemo(id) {
  try {
    const data = await request(`/api/memos/${encodeURIComponent(id)}`);
    fillEditor(data.item, { fromCache: state.lastResponseCacheHit });
  } catch (error) {
    setStatus(`Detail fetch error: ${error.message}`, true);
  }
}

async function saveMemo() {
  if (isReadOnlyPanelSelected()) {
    setStatus("Usage panel is read-only", true);
    return;
  }
  const payload = currentPayload();
  if (!payload.projectName || !payload.threadTitle || !payload.memoBody) {
    setStatus("projectName / threadTitle / memoBody are required", true);
    return;
  }

  try {
    if (state.selectedId) {
      const data = await request(`/api/memos/${encodeURIComponent(state.selectedId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      fillEditor(data.item, { fromCache: false });
      setStatus(`Updated: ${data.item.id}`);
    } else {
      const data = await request("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      fillEditor(data.item, { fromCache: false });
      setStatus(`Created: ${data.item.id}`);
    }
    await loadMemos();
  } catch (error) {
    setStatus(`Save error: ${error.message}`, true);
  }
}

async function deleteSelectedMemo() {
  if (isReadOnlyPanelSelected()) {
    setStatus("Usage panel cannot be deleted", true);
    return;
  }
  if (!state.selectedId) {
    setStatus("Select a memo to delete", true);
    return;
  }
  const selected = state.items.find((memo) => memo.id === state.selectedId);
  if (!selected) {
    setStatus("Selected memo is missing", true);
    return;
  }
  if (selected.pinned) {
    setStatus("Delete blocked: unpin first", true);
    return;
  }
  const confirmMessage = selected.deletable
    ? `Delete selected memo? (${selected.id})`
    : `DEL is off. Turn DEL on and delete this selected memo? (${selected.id})`;
  const ok = window.confirm(confirmMessage);
  if (!ok) {
    setStatus("Delete cancelled", true);
    return;
  }
  if (!selected.deletable) {
    try {
      const promoted = await request(`/api/memos/${encodeURIComponent(selected.id)}/deletable`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletable: true })
      });
      applyUpdatedMemo(promoted.item);
    } catch (error) {
      setStatus(`DEL enable error: ${error.message}`, true);
      return;
    }
  }

  try {
    await request(`/api/memos/${encodeURIComponent(selected.id)}`, {
      method: "DELETE",
      headers: { "x-codex-delete-confirm": "DELETE" }
    });
    fillEditor(null);
    await loadMemos({ forceReload: true, selectFirst: true });
    setStatus(`Deleted: ${selected.id}`, false, "force");
  } catch (error) {
    setStatus(`Delete error: ${error.message}`, true);
  }
}

async function deleteAllDeletableMemos() {
  const targets = state.items.filter((memo) => Boolean(memo.deletable) && !Boolean(memo.pinned));
  if (targets.length === 0) {
    setStatus("No deletable docs", true);
    return;
  }
  const ok = window.confirm(`Delete all deletable docs? (${targets.length})`);
  if (!ok) {
    setStatus("Bulk delete cancelled", true);
    return;
  }

  try {
    for (const memo of targets) {
      await request(`/api/memos/${encodeURIComponent(memo.id)}`, {
        method: "DELETE",
        headers: { "x-codex-delete-confirm": "DELETE" }
      });
    }
    const deletedCount = targets.length;
    state.showOnlyDeletable = false;
    syncDeleteButtonLabel();
    fillEditor(null);
    await loadMemos({ forceReload: true, selectFirst: true });
    setStatus(`Deleted ${deletedCount} deletable docs`, false, "force");
  } catch (error) {
    setStatus(`Delete error: ${error.message}`, true);
  }
}

async function deleteMemo(ev) {
  if (ev && ev.shiftKey) {
    state.showOnlyDeletable = !state.showOnlyDeletable;
    syncDeleteButtonLabel();
    const visibleItems = getVisibleItemsSorted();
    if (state.showOnlyDeletable && state.selectedId && !isSpecialPanelId(state.selectedId) && !visibleItems.some((memo) => memo.id === state.selectedId)) {
      if (visibleItems.length > 0) {
        fillEditor(visibleItems[0], { fromCache: false });
      } else {
        fillEditor(null);
      }
    } else {
      renderList();
    }
    setStatus(
      state.showOnlyDeletable ? "Mode: ALL (deletable only)" : "Mode: Delete (all docs)",
      false,
      "force"
    );
    return;
  }

  if (state.showOnlyDeletable) {
    await deleteAllDeletableMemos();
    return;
  }
  await deleteSelectedMemo();
}

function downloadMemo(format) {
  if (!state.selectedId) {
    setStatus("Select a memo to download", true);
    return;
  }
  if (isReadOnlyPanelSelected()) {
    const memo = currentMemoForExport();
    const body = buildExportBody(memo, format);
    const fileName = ensureFileNameExtension(buildExportFileName(memo, format), format);
    const typeMap = {
      txt: "text/plain;charset=utf-8",
      md: "text/markdown;charset=utf-8",
      json: "application/json;charset=utf-8"
    };
    const blob = new Blob([body], { type: typeMap[format] || typeMap.txt });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus(`Downloaded ${format.toUpperCase()} file`);
    return;
  }
  window.location.href = `/api/memos/${encodeURIComponent(state.selectedId)}/download?format=${format}`;
}

function currentMemoForExport() {
  const selected = state.items.find((memo) => memo.id === state.selectedId) || {};
  return {
    id: selected.id || state.selectedId || "",
    projectName: el.projectNameInput.value.trim(),
    memoType: el.memoTypeInput.value || "memo",
    memoBody: el.memoBodyInput.value || "",
    threadTitle: el.threadTitleInput.value.trim(),
    deletable: Boolean(selected.deletable),
    createdAtISO: selected.createdAtISO || "",
    updatedAtISO: selected.updatedAtISO || "",
    datetimeISO: selected.datetimeISO || ""
  };
}

function buildExportBody(memo, format) {
  if (format === "json") {
    return JSON.stringify(memo, null, 2);
  }
  if (format === "md") {
    return [
      `# ${memo.threadTitle || "(no title)"}`,
      "",
      `- id: ${memo.id}`,
      `- projectName: ${memo.projectName}`,
      `- memoType: ${memo.memoType}`,
      `- deletable: ${memo.deletable}`,
      `- createdAtISO: ${memo.createdAtISO || ""}`,
      `- updatedAtISO: ${memo.updatedAtISO || ""}`,
      "",
      "## Body",
      "",
      memo.memoBody || ""
    ].join("\n");
  }
  return [
    `title: ${memo.threadTitle || ""}`,
    `id: ${memo.id}`,
    `projectName: ${memo.projectName}`,
    `memoType: ${memo.memoType}`,
    `deletable: ${memo.deletable}`,
    `createdAtISO: ${memo.createdAtISO || ""}`,
    `updatedAtISO: ${memo.updatedAtISO || ""}`,
    "",
    memo.memoBody || ""
  ].join("\n");
}

function buildExportFileName(memo, format) {
  const base = String(memo.threadTitle || memo.id || "memo")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "memo";
  return `${base}.${format}`;
}

function ensureFileNameExtension(fileName, format) {
  const normalized = String(fileName || "").trim() || `memo.${format}`;
  const lower = normalized.toLowerCase();
  const suffix = `.${String(format || "txt").toLowerCase()}`;
  return lower.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

async function shareMemo() {
  const format = el.downloadFormatSelect.value || "txt";
  const memo = currentMemoForExport();
  const body = buildExportBody(memo, format);
  const fileName = ensureFileNameExtension(buildExportFileName(memo, format), format);
  const typeMap = {
    txt: "text/plain;charset=utf-8",
    md: "text/markdown;charset=utf-8",
    json: "application/json;charset=utf-8"
  };
  const downloadAsFallback = (reasonText) => {
    const blob = new Blob([body], { type: typeMap[format] || typeMap.txt });
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus(`${reasonText ? `${reasonText}. ` : ""}Downloaded ${format.toUpperCase()} file`);
  };
  const copyAsFallback = async (reasonText) => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      downloadAsFallback(reasonText ? `${reasonText} and Clipboard API unavailable` : "Clipboard API unavailable");
      return;
    }
    await navigator.clipboard.writeText(body);
    setStatus(`${reasonText ? `${reasonText}. ` : ""}Copied ${format.toUpperCase()} text`);
  };
  try {
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      await copyAsFallback("Web Share blocked (no active user gesture)");
      return;
    }

    if (window.self !== window.top && document.permissionsPolicy && !document.permissionsPolicy.allowsFeature("web-share")) {
      await copyAsFallback("Web Share blocked in iframe (allow=web-share required)");
      return;
    }

    if (!navigator.share) {
      await copyAsFallback("Web Share unavailable");
      return;
    }

    // Desktop browsers (especially Chrome on macOS) often deny file-based share
    // even when text share works in the same user gesture.
    if (format === "txt" || format === "md" || format === "json") {
      await navigator.share({
        title: memo.threadTitle || "codex-memo",
        text: body
      });
      setStatus(`Shared as ${format.toUpperCase()} text`);
      return;
    }

    if (typeof File !== "undefined" && navigator.canShare) {
      const file = new File([body], fileName, { type: typeMap[format] || typeMap.txt });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: memo.threadTitle || "codex-memo",
            files: [file]
          });
          setStatus(`Shared ${format.toUpperCase()} file`);
          return;
        } catch (fileShareError) {
          const denied = String(fileShareError?.name || "").toLowerCase();
          if (denied === "notallowederror" || denied === "permissiondeniederror") {
            await copyAsFallback(`File share blocked (${fileShareError.name || "NotAllowedError"})`);
            return;
          }
          throw fileShareError;
        }
      }
    }

    await navigator.share({
      title: memo.threadTitle || "codex-memo",
      text: body
    });
    setStatus(`Shared as ${format.toUpperCase()} text`);
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("Share cancelled");
      return;
    }
    const errorName = (error && error.name) ? String(error.name) : "UnknownError";
    const errorMessage = (error && error.message) ? String(error.message) : "no message";
    const reason = `Share failed (${errorName}: ${errorMessage})`;
    try {
      await copyAsFallback(reason);
    } catch (copyError) {
      setStatus(`Share error: ${reason}. ${copyError.message || copyError}`, true);
    }
  }
}

async function copyBodyText() {
  try {
    await navigator.clipboard.writeText(el.memoBodyInput.value || "");
    setStatus("Copied body text");
  } catch (error) {
    setStatus(`Copy error: ${error.message}`, true);
  }
}

function initEvents() {
  el.newBtn.addEventListener("click", () => {
    setBodyMode("text");
    fillEditor({
      projectName: "common",
      memoType: "memo",
      threadTitle: "",
      memoBody: "",
      deletable: false
    });
    el.threadTitleInput.focus();
    setStatus("New memo mode");
  });
  el.appTitle.addEventListener("dblclick", async () => {
    window.location.reload();
  });

  const onFilterEnter = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      loadMemos();
    }
  };
  const onFilterCleared = (ev) => {
    if (!String(ev.target.value || "").trim()) {
      loadMemos();
    }
  };
  el.qInput.addEventListener("keydown", onFilterEnter);
  el.projectInput.addEventListener("keydown", onFilterEnter);
  el.qInput.addEventListener("input", onFilterCleared);
  el.projectInput.addEventListener("input", onFilterCleared);
  // For search clear button (x) behavior on WebKit browsers.
  el.qInput.addEventListener("search", onFilterCleared);
  el.projectInput.addEventListener("search", onFilterCleared);
  el.typeSelect.addEventListener("change", loadMemos);
  el.bodyModeToggle.addEventListener("click", () => {
    setBodyMode(getBodyMode() === "preview" ? "text" : "preview");
    updateBodyMode();
  });
  el.memoBodyInput.addEventListener("input", () => {
    if (getBodyMode() === "preview") {
      renderMarkdownPreview();
    }
    updateSaveButtonState();
  });
  el.memoBodyInput.addEventListener("click", async (ev) => {
    if (!(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    try {
      const opened = await tryOpenPathAtCursor();
      if (!opened) {
        setStatus("No local path token at cursor", true);
      }
    } catch (error) {
      setStatus(`Open error: ${error.message}`, true);
    }
  });
  el.memoPreview.addEventListener("click", async (ev) => {
    const refsTrigger = ev.target && ev.target.closest ? ev.target.closest("a[data-open-usage-refs]") : null;
    if (refsTrigger) {
      ev.preventDefault();
      openUsageRefs();
      setStatus("Opened usage refs");
      return;
    }
    const target = ev.target && ev.target.closest ? ev.target.closest("a[data-local-path]") : null;
    if (!target) return;
    ev.preventDefault();
    const localPath = normalizePathToken(target.dataset.localPath || "");
    if (!isLocalPathToken(localPath)) {
      setStatus("Invalid local path token", true);
      return;
    }
    try {
      await openLocalPath(localPath);
    } catch (error) {
      setStatus(`Open error: ${error.message}`, true);
    }
  });
  el.projectNameInput.addEventListener("input", updateSaveButtonState);
  el.threadTitleInput.addEventListener("input", updateSaveButtonState);
  el.memoTypeInput.addEventListener("change", updateSaveButtonState);

  el.saveBtn.addEventListener("click", saveMemo);
  el.deleteBtn.addEventListener("click", deleteMemo);
  el.downloadBtn.addEventListener("click", () => downloadMemo(el.downloadFormatSelect.value || "txt"));
  el.copyBodyBtn.addEventListener("click", copyBodyText);
  el.shareBtn.addEventListener("click", shareMemo);
}

initEvents();
fillEditor(null);
setBodyMode("preview");
updateBodyMode();
loadMemos();

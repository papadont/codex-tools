const state = {
  items: [],
  memoCounts: null,
  selectedId: null,
  runtimeConfig: {
    storageMode: "mixed",
    fixedAdapter: null,
    defaultStorageKind: "firebase",
    availableAdapters: ["icloud", "firebase"],
    allowedAdapters: ["icloud", "firebase"],
    adapterDetails: [],
    memoSummaryModel: "gpt-4.1-nano",
    usageOverviewSummaryModel: "gpt-4o-mini",
  },
  quickMemoId: null,
  quickMemoEnsuring: false,
  editorBaseline: null,
  editorStorageKind: "firebase",
  hasInitialAutoSelection: false,
  lastResponseCacheHit: false,
  selectedCacheHit: false,
  showOnlyDeletable: false,
  storageFilterKind: "",
  autoRefreshEnabled: true,
  usageTileCollapsed: false,
  codexUsageSummary: null,
  codexUsageError: "",
  codexUsageFetchedAtISO: "",
  storageUsageSummary: null,
  storageUsageError: "",
  storageUsageFetchedAtISO: "",
  usageSummary: null,
  usageError: "",
  usageFetchedAtISO: "",
  openaiCostsSummary: null,
  openaiCostsError: "",
  openaiCostsFetchedAtISO: "",
  usageOverviewAiSummary: "",
  usageOverviewAiSummaryModel: "",
  usageOverviewAiSummaryError: "",
  usageOverviewAiSummaryKey: "",
  usageRefreshPending: false,
  usageRefreshReason: "",
  persistedUsageOverview: null,
  editorAttachments: [],
  attachmentListExpanded: false,
  markdownCssMemoId: null,
  markdownCssMemoBody: "",
  pointerClientX: 0,
  pointerClientY: 0,
};

const USAGE_OVERVIEW_PANEL_ID = "__usage_overview__";
const CODEX_USAGE_PANEL_ID = "__codex_usage__";
const USAGE_PANEL_ID = "__firestore_usage__";
const QUICK_MEMO_TITLE = "Quick Memo";
const QUICK_MEMO_PROJECT_NAME = "codex-memo";
const QUICK_MEMO_MEMO_TYPE = "keep";
const QUICK_MEMO_DOC_ID = "fixed-quick-memo";
const USAGE_OVERVIEW_DOC_ID = "fixed-usage-overview";
const USAGE_OVERVIEW_SNAPSHOT_MARKER = "codex-memo:usage-overview-snapshot";
const QUICK_MEMO_LEGACY_PROJECT_NAMES = new Set([
  "common",
  QUICK_MEMO_PROJECT_NAME,
]);
const USAGE_PANEL_HOURS = 24 * 14;
const USAGE_FETCH_TIMEOUT_MS = 8000;
const USAGE_OVERVIEW_SHARED = window.UsageOverviewShared;
const USAGE_REF_PAGE_URLS = USAGE_OVERVIEW_SHARED.getUsageRefPageUrls();
const USAGE_REF_URLS_BY_KEY = Object.fromEntries(
  USAGE_OVERVIEW_SHARED.USAGE_REF_LINKS.map((link) => [link.key, link.url]),
);
const OPENAI_COSTS_FETCH_TIMEOUT_MS = 20_000;
const STATUS_BANNER_DEFAULT_MS = 3000;
const STATUS_BANNER_ERROR_MS = 12000;
const STATUS_BANNER_FORCE_MS = 3000;
const STATUS_BANNER_DANGER_MS = 0;
const FONT_PREFS_STORAGE_KEY = "codex-memo-font-prefs-v1";
const DEFAULT_MEMO_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const DEFAULT_FONT_PREFS = Object.freeze({
  memoFontName: "",
  memoFontSize: 14,
});
const MARKDOWN_CSS_MEMO_PROJECT_NAME = "codex-memo";
const MARKDOWN_CSS_MEMO_TYPE = "keep";
const MARKDOWN_CSS_MEMO_TITLE = "Markdown CSS";
const DEFAULT_MARKDOWN_CUSTOM_CSS = [
  "/* codex-memo markdown preview overrides */",
  "/* ここに書いたCSSが preview にそのまま当たるよ */",
  "/* 使うセレクタ例: .markdown-preview h1 / .markdown-preview pre code */",
  "",
  ".markdown-preview {",
  "  color: #4b5568;",
  "  background: transparent;",
  "  line-height: 1.65;",
  "  letter-spacing: 0;",
  "  word-break: break-word;",
  "  overflow-wrap: anywhere;",
  "}",
  "",
  ".markdown-preview h1,",
  ".markdown-preview h2,",
  ".markdown-preview h3 {",
  "  font-family: inherit;",
  "  letter-spacing: 0;",
  "}",
  "",
  ".markdown-preview h1 {",
  "  color: #4f5f7e;",
  "  font-size: 1.26em;",
  "  font-weight: 700;",
  "  line-height: 1.3;",
  "  margin: 0.5em 0 0.72em;",
  "  padding: 0 0 0.24em;",
  "  border: 0;",
  "  border-bottom: 1px solid #d8d3cc;",
  "  border-radius: 0;",
  "  background: transparent;",
  "}",
  "",
  ".markdown-preview h2 {",
  "  color: #605e5a;",
  "  font-size: 1.05em;",
  "  font-weight: 700;",
  "  line-height: 1.35;",
  "  margin: 0.95em 0 0.45em;",
  "  padding-left: 0.5em;",
  "  border-left: 2px solid #d8d3cc;",
  "  border-bottom: 0;",
  "  background: transparent;",
  "}",
  "",
  ".markdown-preview h3 {",
  "  color: #626b78;",
  "  font-size: 1.02em;",
  "  font-weight: 650;",
  "  line-height: 1.35;",
  "  margin: 0.8em 0 0.3em;",
  "  padding: 0;",
  "  border: 0;",
  "}",
  "",
  ".markdown-preview p {",
  "  color: inherit;",
  "  font-size: 1em;",
  "  font-weight: 400;",
  "  line-height: 1.65;",
  "  margin: 0.4em 0;",
  "}",
  "",
  ".markdown-preview p + p {",
  "  margin-top: 0.9em;",
  "}",
  "",
  ".markdown-preview small {",
  "  color: #64748b;",
  "  font-size: 0.8em;",
  "  line-height: 1.25;",
  "}",
  "",
  ".markdown-preview ul,",
  ".markdown-preview ol {",
  "  margin: 0.7em 0;",
  "  padding-left: 1.25em;",
  "}",
  "",
  ".markdown-preview ul {",
  "  list-style-type: disc;",
  "}",
  "",
  ".markdown-preview ol {",
  "  list-style-type: decimal;",
  "}",
  "",
  ".markdown-preview li {",
  "  display: list-item;",
  "  margin: 0.22em 0;",
  "}",
  "",
  ".markdown-preview ul.md-list-dash {",
  "  list-style: none;",
  "  padding-left: 0;",
  "}",
  "",
  ".markdown-preview table {",
  "  width: 100%;",
  "  margin: 0.95em 0;",
  "  border-collapse: collapse;",
  "  font-size: 0.94em;",
  "  table-layout: auto;",
  "}",
  "",
  ".markdown-preview th,",
  ".markdown-preview td {",
  "  border: 1px solid #cbd5e1;",
  "  padding: 4px 8px;",
  "  vertical-align: top;",
  "  text-align: left;",
  "}",
  "",
  ".markdown-preview th {",
  "  background: #f3f4f6;",
  "  color: inherit;",
  "  font-weight: 600;",
  "}",
  "",
  ".markdown-preview blockquote {",
  "  margin: 0.74em 0;",
  "  padding: 0.28em 0 0.22em 1.02em;",
  "  color: #5f5950;",
  "  background-color: #f3f1ec;",
  "  background-image: linear-gradient(#cfc8bf, #cfc8bf);",
  "  background-repeat: no-repeat;",
  "  background-size: 4px calc(100% - 18px);",
  "  background-position: left 6px top 9px;",
  "  border: 0;",
  "  border-radius: 8px;",
  "}",
  "",
  ".markdown-preview a {",
  "  color: #4e6f9f;",
  "  text-decoration: none;",
  "  text-underline-offset: 2px;",
  "}",
  "",
  ".markdown-preview a:hover {",
  "  text-decoration: underline;",
  "}",
  "",
  ".markdown-preview img {",
  "  display: block;",
  "  max-width: 100%;",
  "  height: auto;",
  "  margin: 0.7em 0;",
  "  border: 1px solid rgba(91, 105, 129, 0.12);",
  "  border-radius: 8px;",
  "  box-shadow: none;",
  "}",
  "",
  ".markdown-preview code {",
  "  color: #f7f5ef;",
  "  background: #666e79;",
  "  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;",
  "  font-size: 0.96em;",
  "  font-weight: 400;",
  "  line-height: 1.45;",
  "  padding: 1px 4px;",
  "  border: 1.5px solid #828a95;",
  "  border-radius: 4px;",
  "  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);",
  "}",
  "",
  ".markdown-preview pre {",
  "  color: #f7f5ef;",
  "  background: #666e79;",
  "  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;",
  "  font-size: 0.96em;",
  "  line-height: 1.45;",
  "  margin: 0.95em 0;",
  "  padding: 8px;",
  "  overflow-x: hidden;",
  "  overflow-y: auto;",
  "  white-space: pre-wrap;",
  "  word-break: break-word;",
  "  overflow-wrap: anywhere;",
  "  border: 1.5px solid #828a95;",
  "  border-radius: 8px;",
  "  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);",
  "}",
  "",
  ".markdown-preview pre code {",
  "  color: inherit;",
  "  background: transparent;",
  "  padding: 0;",
  "  border: 0;",
  "  border-radius: 0;",
  "  box-shadow: none;",
  "  white-space: inherit;",
  "  word-break: inherit;",
  "  overflow-wrap: inherit;",
  "}",
  "",
  ".markdown-preview hr {",
  "  margin: 1em 0;",
  "  border: 0;",
  "  border-top: 1px solid #d8d3cc;",
  "}",
  "",
  ".markdown-preview :is(p, ul, ol, table, blockquote, pre) + h1,",
  ".markdown-preview :is(p, ul, ol, table, blockquote, pre) + h2,",
  ".markdown-preview :is(p, ul, ol, table, blockquote, pre) + h3 {",
  "  margin-top: 1.25em;",
  "}",
  "",
  ".markdown-preview p + :is(ul, ol, table, blockquote, pre),",
  ".markdown-preview table + p,",
  ".markdown-preview blockquote + p,",
  ".markdown-preview pre + p {",
  "  margin-top: 1.05em;",
  "}",
  "",
  ".markdown-preview :is(ul, ol) + :is(ul, ol) {",
  "  margin-top: 1.4em;",
  "}",
  "",
  ".markdown-preview :is(table, blockquote, pre) + :is(ul, ol) {",
  "  margin-top: 1.35em;",
  "}",
  "",
  ".markdown-preview :is(ul, ol) + p {",
  "  margin-top: 0.9em;",
  "}",
].join("\n");
const FONT_BOOK_APP_CANDIDATES = [
  "/System/Applications/Font Book.app",
  "/Applications/Font Book.app",
];

let usageRefreshInFlight = null;
let usageOverviewSummaryInFlight = null;
let attachmentLightbox = null;
let statusBannerTimer = null;
let mermaidInitialized = false;
let mermaidRenderSeq = 0;

function usageSourceFooterLines() {
  return USAGE_OVERVIEW_SHARED.usageSourceFooterLines({ interactive: true });
}

const el = {
  memoList: document.getElementById("memoList"),
  memoSidebar: document.getElementById("memoSidebar"),
  memoSidebarScroll: document.getElementById("memoSidebarScroll"),
  memoCountStatus: document.getElementById("memoCountStatus"),
  usagePanelSlot: document.getElementById("usagePanelSlot"),
  appTitle: document.getElementById("appTitle"),
  qInput: document.getElementById("qInput"),
  projectInput: document.getElementById("projectInput"),
  typeSelect: document.getElementById("typeSelect"),
  storageFilterWrap: document.getElementById("storageFilterWrap"),
  storageFilterSelect: document.getElementById("storageFilterSelect"),
  autoRefreshIndicator: document.getElementById("autoRefreshIndicator"),
  modeBadge: document.getElementById("modeBadge"),
  defaultStorageWrap: document.getElementById("defaultStorageWrap"),
  defaultStorageSelect: document.getElementById("defaultStorageSelect"),
  editStorageWrap: document.getElementById("editStorageWrap"),
  editStorageSelect: document.getElementById("editStorageSelect"),
  newBtn: document.getElementById("newBtn"),
  projectNameInput: document.getElementById("projectNameInput"),
  memoTypeInput: document.getElementById("memoTypeInput"),
  threadTitleInput: document.getElementById("threadTitleInput"),
  editorDivider: document.getElementById("editorDivider"),
  docIdRow: document.getElementById("docIdRow"),
  docIdText: document.getElementById("docIdText"),
  copyDocIdBtn: document.getElementById("copyDocIdBtn"),
  addImageBtn: document.getElementById("addImageBtn"),
  attachmentInput: document.getElementById("attachmentInput"),
  attachmentToggle: document.getElementById("attachmentToggle"),
  attachmentList: document.getElementById("attachmentList"),
  storageInfo: document.getElementById("storageInfo"),
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
  summaryBtn: document.getElementById("summaryBtn"),
  appMenuBtn: document.getElementById("appMenuBtn"),
  appMenuPanel: document.getElementById("appMenuPanel"),
  menuMemoFontBtn: document.getElementById("menuMemoFontBtn"),
  menuMarkdownCssBtn: document.getElementById("menuMarkdownCssBtn"),
  fontSettingsDialog: document.getElementById("fontSettingsDialog"),
  memoFontNameInput: document.getElementById("memoFontNameInput"),
  memoFontSizeInput: document.getElementById("memoFontSizeInput"),
  fontSettingsSaveBtn: document.getElementById("fontSettingsSaveBtn"),
  fontSettingsCancelBtn: document.getElementById("fontSettingsCancelBtn"),
  fontSettingsResetBtn: document.getElementById("fontSettingsResetBtn"),
  statusBanner: document.getElementById("statusBanner"),
  statusTitle: document.getElementById("statusTitle"),
  statusIcon: document.getElementById("statusIcon"),
  status: document.getElementById("status"),
};

let summaryTooltipEl = null;
let summaryRequestSeq = 0;

function clampFontSize(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeFontPrefs(raw = {}) {
  return {
    memoFontName: String(raw.memoFontName || "").trim(),
    memoFontSize: clampFontSize(
      raw.memoFontSize,
      DEFAULT_FONT_PREFS.memoFontSize,
      10,
      32,
    ),
  };
}

function buildFontFamilyValue(name, fallback) {
  const raw = String(name || "").trim();
  return raw ? `${raw}, ${fallback}` : fallback;
}

function syncFontSettingsInputs(prefs = DEFAULT_FONT_PREFS) {
  if (el.memoFontNameInput)
    el.memoFontNameInput.value = prefs.memoFontName || "";
  if (el.memoFontSizeInput)
    el.memoFontSizeInput.value = String(
      prefs.memoFontSize || DEFAULT_FONT_PREFS.memoFontSize,
    );
}

function applyFontPrefs(rawPrefs = DEFAULT_FONT_PREFS) {
  const prefs = normalizeFontPrefs(rawPrefs);
  const root = document.documentElement;
  root.style.setProperty(
    "--memo-font-family",
    buildFontFamilyValue(prefs.memoFontName, DEFAULT_MEMO_FONT_STACK),
  );
  root.style.setProperty("--memo-font-size", `${prefs.memoFontSize}px`);
  syncFontSettingsInputs(prefs);
  return prefs;
}

function loadFontPrefs() {
  try {
    const raw = window.localStorage.getItem(FONT_PREFS_STORAGE_KEY);
    if (!raw) return applyFontPrefs(DEFAULT_FONT_PREFS);
    return applyFontPrefs(JSON.parse(raw));
  } catch (error) {
    console.warn("[codex-memo] font prefs load failed:", error);
    return applyFontPrefs(DEFAULT_FONT_PREFS);
  }
}

function saveFontPrefs(prefs) {
  const normalized = applyFontPrefs(prefs);
  window.localStorage.setItem(
    FONT_PREFS_STORAGE_KEY,
    JSON.stringify(normalized),
  );
  return normalized;
}

function currentFontPrefsFromDialog() {
  return normalizeFontPrefs({
    memoFontName: el.memoFontNameInput?.value || "",
    memoFontSize:
      el.memoFontSizeInput?.value || DEFAULT_FONT_PREFS.memoFontSize,
  });
}

function openFontSettingsDialog() {
  if (!el.fontSettingsDialog) return;
  syncFontSettingsInputs(loadFontPrefs());
  if (typeof el.fontSettingsDialog.showModal === "function") {
    el.fontSettingsDialog.showModal();
  } else {
    el.fontSettingsDialog.setAttribute("open", "open");
  }
}

function closeFontSettingsDialog() {
  if (!el.fontSettingsDialog) return;
  if (typeof el.fontSettingsDialog.close === "function") {
    el.fontSettingsDialog.close();
  } else {
    el.fontSettingsDialog.removeAttribute("open");
  }
}

function normalizeMarkdownCustomCss(raw) {
  return typeof raw === "string"
    ? raw.replace(/\r\n?/g, "\n")
    : DEFAULT_MARKDOWN_CUSTOM_CSS;
}

function buildMarkdownCssMemoSeed(storageKind = currentDefaultStorageKind()) {
  return {
    projectName: MARKDOWN_CSS_MEMO_PROJECT_NAME,
    memoType: MARKDOWN_CSS_MEMO_TYPE,
    threadTitle: MARKDOWN_CSS_MEMO_TITLE,
    memoBody: DEFAULT_MARKDOWN_CUSTOM_CSS,
    storageKind: normalizeStorageKind(storageKind, currentDefaultStorageKind()),
    attachments: [],
    deletable: false,
  };
}

function isMarkdownCssMemoItem(item) {
  return Boolean(
    item &&
    String(item.projectName || "") === MARKDOWN_CSS_MEMO_PROJECT_NAME &&
    String(item.memoType || "") === MARKDOWN_CSS_MEMO_TYPE &&
    String(item.threadTitle || "") === MARKDOWN_CSS_MEMO_TITLE,
  );
}

function ensureMarkdownCustomCssStyleTag() {
  let styleEl = document.getElementById("markdownCustomCssStyle");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "markdownCustomCssStyle";
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

function strengthenMarkdownCustomCss(css) {
  return String(css || "").replace(
    /(^|[;{]\s*)([A-Za-z-]+\s*:\s*[^;{}]+)(;?)/g,
    (match, prefix, declaration, suffix) => {
      if (/!important\b/.test(declaration)) return match;
      return `${prefix}${declaration} !important${suffix || ""}`;
    },
  );
}

function applyMarkdownCustomCss(rawCss = DEFAULT_MARKDOWN_CUSTOM_CSS) {
  const css = normalizeMarkdownCustomCss(rawCss);
  ensureMarkdownCustomCssStyleTag().textContent =
    strengthenMarkdownCustomCss(css);
  return css;
}

function syncMarkdownCssMemoState(item) {
  if (isMarkdownCssMemoItem(item)) {
    state.markdownCssMemoId = item.id || null;
    state.markdownCssMemoBody = normalizeMarkdownCustomCss(
      item.memoBody || DEFAULT_MARKDOWN_CUSTOM_CSS,
    );
    return state.markdownCssMemoBody;
  }
  if (!state.markdownCssMemoBody) {
    state.markdownCssMemoBody = DEFAULT_MARKDOWN_CUSTOM_CSS;
  }
  return state.markdownCssMemoBody;
}

function upsertMemoInState(item) {
  if (!item || !item.id) return;
  const index = state.items.findIndex((memo) => memo.id === item.id);
  if (index >= 0) {
    state.items[index] = item;
  } else {
    state.items.unshift(item);
  }
}

function applyMarkdownCustomCssFromMemo(item) {
  return applyMarkdownCustomCss(syncMarkdownCssMemoState(item));
}

async function findMarkdownCssMemo() {
  const existingInState = state.items.find((item) =>
    isMarkdownCssMemoItem(item),
  );
  if (existingInState) {
    syncMarkdownCssMemoState(existingInState);
    return existingInState;
  }
  const params = new URLSearchParams();
  params.set("projectName", MARKDOWN_CSS_MEMO_PROJECT_NAME);
  params.set("memoType", MARKDOWN_CSS_MEMO_TYPE);
  const data = await request(`/api/memos?${params.toString()}`);
  const item =
    (Array.isArray(data.items) ? data.items : []).find((memo) =>
      isMarkdownCssMemoItem(memo),
    ) || null;
  if (item) syncMarkdownCssMemoState(item);
  return item;
}

async function ensureMarkdownCssMemo() {
  const existing = await findMarkdownCssMemo();
  if (existing) return existing;
  const data = await request("/api/memos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildMarkdownCssMemoSeed()),
  });
  syncMarkdownCssMemoState(data.item);
  return data.item;
}

async function openMarkdownCssMemo() {
  if (!confirmDiscardEditorChanges()) return;
  const existing = await findMarkdownCssMemo();
  const item = existing || (await ensureMarkdownCssMemo());
  upsertMemoInState(item);
  applyMarkdownCustomCssFromMemo(item);
  fillEditor(item, { fromCache: false, editorStorageKind: item.storageKind });
  setBodyMode("text");
  updateBodyMode();
  el.memoBodyInput.focus();
  setStatus(existing ? "Markdown CSS memo" : "Markdown CSS memo created");
}

function isAppMenuOpen() {
  return Boolean(el.appMenuPanel && !el.appMenuPanel.hidden);
}

function positionAppMenu() {
  if (!el.appMenuBtn || !el.appMenuPanel) return;
  const rect = el.appMenuBtn.getBoundingClientRect();
  const panelWidth = el.appMenuPanel.offsetWidth || 220;
  const panelHeight = el.appMenuPanel.offsetHeight || 96;
  const gap = 6;
  const left = Math.min(
    Math.max(8, rect.right - panelWidth),
    Math.max(8, window.innerWidth - panelWidth - 8),
  );
  const top =
    rect.bottom + gap + panelHeight <= window.innerHeight - 8
      ? rect.bottom + gap
      : Math.max(8, rect.top - panelHeight - gap);
  el.appMenuPanel.style.left = `${Math.round(left)}px`;
  el.appMenuPanel.style.top = `${Math.round(top)}px`;
}

function openAppMenu() {
  if (!el.appMenuPanel) return;
  el.appMenuPanel.hidden = false;
  positionAppMenu();
  el.appMenuBtn?.setAttribute("aria-expanded", "true");
}

function closeAppMenu() {
  if (!el.appMenuPanel) return;
  el.appMenuPanel.hidden = true;
  el.appMenuBtn?.setAttribute("aria-expanded", "false");
}

function toggleAppMenu(force) {
  const next = typeof force === "boolean" ? force : !isAppMenuOpen();
  if (next) openAppMenu();
  else closeAppMenu();
}

async function request(path, options) {
  const res = await fetch(path, options);
  state.lastResponseCacheHit =
    String(res.headers.get("X-Cache") || "").toUpperCase() === "HIT";
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

async function loadRuntimeConfig() {
  const data = await request("/api/runtime-config");
  state.runtimeConfig = {
    storageMode: data.storageMode || "mixed",
    fixedAdapter: data.fixedAdapter || null,
    defaultStorageKind: normalizeStorageKind(
      data.defaultStorageKind,
      "firebase",
    ),
    availableAdapters:
      Array.isArray(data.availableAdapters) && data.availableAdapters.length
        ? data.availableAdapters.map((item) => normalizeStorageKind(item))
        : ["icloud", "firebase"],
    allowedAdapters:
      Array.isArray(data.allowedAdapters) && data.allowedAdapters.length
        ? data.allowedAdapters.map((item) => normalizeStorageKind(item))
        : ["icloud", "firebase"],
    adapterDetails: Array.isArray(data.adapterDetails)
      ? data.adapterDetails
      : [],
    memoSummaryModel:
      String(data.memoSummaryModel || "gpt-4.1-nano").trim() || "gpt-4.1-nano",
    usageOverviewSummaryModel:
      String(data.usageOverviewSummaryModel || "gpt-4o-mini").trim() ||
      "gpt-4o-mini",
  };
  renderSummaryButtonTooltip(state.runtimeConfig.memoSummaryModel);
  renderStorageControls();
}

function setStatus(message, isError = false, tone = "default") {
  if (!el.status || !el.statusBanner || !el.statusTitle || !el.statusIcon)
    return;
  if (statusBannerTimer) {
    clearTimeout(statusBannerTimer);
    statusBannerTimer = null;
  }

  const text = String(message || "").trim();
  if (!text) {
    el.status.textContent = "";
    el.statusTitle.textContent = "Message";
    el.statusIcon.textContent = "i";
    el.statusBanner.classList.remove(
      "is-visible",
      "is-error",
      "is-danger",
      "is-force",
    );
    return;
  }

  el.status.textContent = text;
  el.statusTitle.textContent = isError
    ? "Warning"
    : tone === "danger"
      ? "Error"
      : tone === "force"
        ? "Notice"
        : "Message";
  el.statusIcon.textContent = isError
    ? "!"
    : tone === "danger"
      ? "x"
      : tone === "force"
        ? "!"
        : "i";
  el.statusBanner.classList.remove("is-error", "is-danger", "is-force");
  if (isError) {
    el.statusBanner.classList.add("is-error");
  } else if (tone === "danger") {
    el.statusBanner.classList.add("is-danger");
  } else if (tone === "force") {
    el.statusBanner.classList.add("is-force");
  }
  el.statusBanner.classList.add("is-visible");

  const duration = isError
    ? STATUS_BANNER_ERROR_MS
    : tone === "danger"
      ? STATUS_BANNER_DANGER_MS
      : tone === "force"
        ? STATUS_BANNER_FORCE_MS
        : STATUS_BANNER_DEFAULT_MS;
  if (duration > 0) {
    statusBannerTimer = setTimeout(() => {
      el.statusBanner.classList.remove(
        "is-visible",
        "is-error",
        "is-danger",
        "is-force",
      );
      statusBannerTimer = null;
    }, duration);
  }
}

function hideStatusBanner() {
  if (statusBannerTimer) {
    clearTimeout(statusBannerTimer);
    statusBannerTimer = null;
  }
  if (el.status) {
    el.status.textContent = "";
  }
  if (el.statusTitle) {
    el.statusTitle.textContent = "Message";
  }
  if (el.statusIcon) {
    el.statusIcon.textContent = "i";
  }
  if (el.statusBanner) {
    el.statusBanner.classList.remove(
      "is-visible",
      "is-error",
      "is-danger",
      "is-force",
    );
  }
}

function syncStickySlotDivider() {
  if (!el.memoSidebarScroll || !el.usagePanelSlot) return;
  el.usagePanelSlot.classList.toggle(
    "sticky-slot-scrolled",
    Number(el.memoSidebarScroll.scrollTop || 0) > 0,
  );
}

function renderMemoCountStatus() {
  if (!el.memoCountStatus) return;
  const counts = state.memoCounts;
  if (!counts) {
    el.memoCountStatus.textContent = "Total memos —";
    return;
  }
  el.memoCountStatus.replaceChildren();
  const parts = [
    ["Total memos ", counts.total],
    [" · Firebase ", counts.firebase],
    [" + iCloud ", counts.icloud],
  ];
  for (const [label, value] of parts) {
    el.memoCountStatus.append(document.createTextNode(label));
    const strong = document.createElement("strong");
    strong.className = "font-bold text-[#56647d]";
    strong.textContent = String(value);
    el.memoCountStatus.append(strong);
  }
}

async function loadMemoCounts(options = {}) {
  const params = new URLSearchParams();
  if (options.forceReload) params.set("nocache", "1");
  try {
    const res = await fetch(`/api/memo-counts?${params.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    state.memoCounts = body.counts || null;
    renderMemoCountStatus();
  } catch (_error) {
    if (!state.memoCounts) renderMemoCountStatus();
  }
}

function renderAutoRefreshIndicator() {
  if (!el.autoRefreshIndicator) return;
  el.autoRefreshIndicator.title = state.autoRefreshEnabled
    ? "Auto refresh ON"
    : "Auto refresh OFF";
  el.autoRefreshIndicator.setAttribute(
    "aria-pressed",
    state.autoRefreshEnabled ? "true" : "false",
  );
  el.autoRefreshIndicator.className = state.autoRefreshEnabled
    ? "h-2.5 w-2.5 rounded-full border border-[#8eb991] bg-[#8fcf95] shadow-[0_0_0_1px_rgba(255,255,255,0.55)_inset,0_0_5px_rgba(143,207,149,0.55)]"
    : "h-2.5 w-2.5 rounded-full border border-[#bfc6d1] bg-[#e7eaf0]";
}

function renderSummaryButtonTooltip(modelName = "") {
  if (!el.summaryBtn) return;
  const model = String(modelName || "").trim() || getActiveSummaryModelName();
  el.summaryBtn.title = `AI summary (${model})`;
}

function getActiveSummaryModelName() {
  if (isUsageOverviewPanelSelected()) {
    return (
      String(
        state.usageOverviewAiSummaryModel ||
          state.runtimeConfig?.usageOverviewSummaryModel ||
          "gpt-4o-mini",
      ).trim() || "gpt-4o-mini"
    );
  }
  return (
    String(state.runtimeConfig?.memoSummaryModel || "gpt-4.1-nano").trim() ||
    "gpt-4.1-nano"
  );
}

function notifyAutoRefreshDisabled() {
  setStatus("Auto refresh OFF。タイトルをダブルクリックで更新", false, "force");
}

function maybeRunAutoRefresh(task) {
  if (state.autoRefreshEnabled) {
    return task();
  }
  notifyAutoRefreshDisabled();
  return Promise.resolve(false);
}

function ensureSummaryTooltip() {
  if (summaryTooltipEl && summaryTooltipEl.isConnected) return summaryTooltipEl;
  const tip = document.createElement("div");
  tip.id = "summaryTooltip";
  tip.className =
    "fixed z-[120] hidden max-w-[min(420px,calc(100vw-24px))] rounded-xl border border-[#4b5563] bg-[#4b5563] px-3 py-2 shadow-sm";
  tip.style.pointerEvents = "none";
  tip.style.whiteSpace = "pre-wrap";
  tip.style.lineHeight = "1.45";
  tip.style.color = "#e5e7eb";
  tip.style.fontSize = "12px";
  tip.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.18)";

  const head = document.createElement("div");
  head.className =
    "mb-1 text-[10px] font-semibold tracking-wide text-[#cbd5e1]";
  head.dataset.role = "head";

  const body = document.createElement("div");
  body.className = "text-[12px]";
  body.dataset.role = "body";

  tip.appendChild(head);
  tip.appendChild(body);
  document.body.appendChild(tip);
  summaryTooltipEl = tip;
  return tip;
}

function positionSummaryTooltip(x, y) {
  const tip = ensureSummaryTooltip();
  const pad = 14;
  const vw = window.innerWidth || document.documentElement.clientWidth || 1200;
  const vh = window.innerHeight || document.documentElement.clientHeight || 800;
  tip.classList.remove("hidden");
  const rect = tip.getBoundingClientRect();
  let left = Number(x || 0) + 14;
  let top = Number(y || 0) + 16;
  if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad);
  if (top + rect.height + pad > vh)
    top = Math.max(pad, Number(y || 0) - rect.height - 12);
  tip.style.left = `${Math.max(pad, left)}px`;
  tip.style.top = `${Math.max(pad, top)}px`;
}

function showSummaryTooltip({
  head,
  body,
  isError = false,
  followPointer = true,
}) {
  const tip = ensureSummaryTooltip();
  const headEl = tip.querySelector('[data-role="head"]');
  const bodyEl = tip.querySelector('[data-role="body"]');
  if (headEl) headEl.textContent = head || "summary";
  if (bodyEl) bodyEl.textContent = body || "";
  tip.dataset.followPointer = followPointer ? "1" : "0";
  tip.style.borderColor = isError ? "#cf7896" : "#4b5563";
  tip.style.background = "#4b5563";
  tip.classList.remove("hidden");
  positionSummaryTooltip(state.pointerClientX || 0, state.pointerClientY || 0);
}

function hideSummaryTooltip() {
  if (!summaryTooltipEl) return;
  summaryTooltipEl.classList.add("hidden");
}

function rememberPointerPosition(ev) {
  if (!ev) return;
  if (Number.isFinite(ev.clientX)) state.pointerClientX = ev.clientX;
  if (Number.isFinite(ev.clientY)) state.pointerClientY = ev.clientY;
  if (
    summaryTooltipEl &&
    !summaryTooltipEl.classList.contains("hidden") &&
    summaryTooltipEl.dataset.followPointer === "1"
  ) {
    positionSummaryTooltip(state.pointerClientX, state.pointerClientY);
  }
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
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function normalizeStorageKind(value, fallback = "firebase") {
  if (value === undefined || value === null) {
    return fallback;
  }
  const raw = String(value).trim().toLowerCase();
  return raw || fallback;
}

function displayStorageKindLabel(value) {
  switch (normalizeStorageKind(value)) {
    case "icloud":
      return "iCloud";
    default:
      return "Firestore";
  }
}

function storageBadgeText(value) {
  switch (normalizeStorageKind(value)) {
    case "icloud":
      return "iCL";
    default:
      return "FB";
  }
}

function storageBadgeClass(value) {
  switch (normalizeStorageKind(value)) {
    case "icloud":
      return "border-[#c8d8ee] bg-[#edf5ff] text-[#5773a0]";
    default:
      return "border-[#f0d4b2] bg-[#fbf2e6] text-[#92633c]";
  }
}

function modeBadgeClass(value, storageMode = "mixed") {
  if (storageMode !== "fixed") {
    return {
      border: "border-[#cfd4dd]",
      bg: "bg-transparent",
      text: "text-[#7a8493]",
    };
  }
  switch (normalizeStorageKind(value)) {
    case "icloud":
      return {
        border: "border-[#9eaecd]",
        bg: "bg-transparent",
        text: "text-[#6e84ad]",
      };
    default:
      return {
        border: "border-[#e2b1c2]",
        bg: "bg-transparent",
        text: "text-[#cf7896]",
      };
  }
}

function currentRuntimeConfig() {
  return (
    state.runtimeConfig || {
      storageMode: "mixed",
      fixedAdapter: null,
      defaultStorageKind: "firebase",
      availableAdapters: ["icloud", "firebase"],
      allowedAdapters: ["icloud", "firebase"],
      adapterDetails: [],
    }
  );
}

function currentAllowedAdapters() {
  return currentRuntimeConfig().allowedAdapters || ["icloud", "firebase"];
}

function storagePathFor(kind) {
  const details = currentRuntimeConfig().adapterDetails || [];
  const found = details.find(
    (item) => normalizeStorageKind(item.kind) === normalizeStorageKind(kind),
  );
  return found?.path || "";
}

function currentDefaultStorageKind() {
  return normalizeStorageKind(
    currentRuntimeConfig().defaultStorageKind,
    "firebase",
  );
}

function selectedDefaultStorageKind() {
  return normalizeStorageKind(
    el.defaultStorageSelect?.value || currentDefaultStorageKind(),
    currentDefaultStorageKind(),
  );
}

function currentEditingStorageKind() {
  return normalizeStorageKind(
    state.editorStorageKind,
    currentDefaultStorageKind(),
  );
}

function setEditorStorageKind(value) {
  state.editorStorageKind = normalizeStorageKind(
    value,
    currentDefaultStorageKind(),
  );
}

function currentEditableStorageOptions() {
  return currentAllowedAdapters().filter(
    (kind) => kind === "icloud" || kind === "firebase",
  );
}

function isHiddenSystemMemo(item) {
  const id = String(item?.id || "");
  return id === QUICK_MEMO_DOC_ID || id === USAGE_OVERVIEW_DOC_ID;
}

function currentStorageFilterKind() {
  if (el.storageFilterSelect) {
    return normalizeStorageKind(el.storageFilterSelect.value, "");
  }
  return normalizeStorageKind(state.storageFilterKind || "", "");
}

function generateAttachmentId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `att_${window.crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `att_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function attachmentRoute(memoId, attachmentId) {
  return `/api/memos/${encodeURIComponent(memoId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function normalizeEditorAttachment(item) {
  if (!item || typeof item !== "object" || !item.id) return null;
  const mimeType = item.mimeType || "application/octet-stream";
  const kind =
    item.kind ||
    (String(mimeType).toLowerCase().startsWith("image/") ? "image" : "file");
  return {
    id: String(item.id),
    kind,
    fileName: item.fileName ? String(item.fileName) : "",
    mimeType,
    size: Number(item.size || 0),
    caption: item.caption ? String(item.caption) : "",
    width: item.width === undefined ? undefined : Number(item.width),
    height: item.height === undefined ? undefined : Number(item.height),
    storagePath: item.storagePath ? String(item.storagePath) : "",
    previewUrl: item.previewUrl ? String(item.previewUrl) : "",
    dataUrl: item.dataUrl ? String(item.dataUrl) : "",
    createdAtISO: item.createdAtISO
      ? String(item.createdAtISO)
      : new Date().toISOString(),
  };
}

function normalizeEditorAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEditorAttachment).filter(Boolean);
}

function currentEditorAttachments() {
  return normalizeEditorAttachments(state.editorAttachments);
}

function attachmentPreviewUrl(item) {
  if (!item) return "";
  if (item.dataUrl) return item.dataUrl;
  if (item.previewUrl) return item.previewUrl;
  if (state.selectedId && !isSpecialPanelId(state.selectedId)) {
    return attachmentRoute(state.selectedId, item.id);
  }
  return "";
}

function buildQuickMemoSeed(storageKind = currentDefaultStorageKind()) {
  return {
    projectName: QUICK_MEMO_PROJECT_NAME,
    memoType: QUICK_MEMO_MEMO_TYPE,
    threadTitle: QUICK_MEMO_TITLE,
    memoBody: "",
    storageKind: normalizeStorageKind(storageKind, currentDefaultStorageKind()),
    attachments: [],
    deletable: false,
    pinned: false,
  };
}

function matchesQuickMemoSignature(item) {
  return Boolean(
    item &&
    String(item.threadTitle || "") === QUICK_MEMO_TITLE &&
    QUICK_MEMO_LEGACY_PROJECT_NAMES.has(String(item.projectName || "")) &&
    String(item.memoType || "") === QUICK_MEMO_MEMO_TYPE,
  );
}

function normalizeQuickMemoItem(item) {
  const base = buildQuickMemoSeed(
    item?.storageKind || currentDefaultStorageKind(),
  );
  return {
    ...base,
    ...(item || {}),
    projectName: QUICK_MEMO_PROJECT_NAME,
    memoType: QUICK_MEMO_MEMO_TYPE,
    threadTitle: QUICK_MEMO_TITLE,
    deletable: false,
    pinned: false,
    storageKind: normalizeStorageKind(item?.storageKind, base.storageKind),
  };
}

function quickMemoUpdatedAtMs(item) {
  const value =
    item?.updatedAtISO || item?.createdAtISO || item?.datetimeISO || "";
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function quickMemoHasContent(item) {
  const body = String(item?.memoBody || "").trim();
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  return Boolean(body || attachments.length);
}

function bestLegacyQuickMemoItem(items = state.items) {
  return (
    items
      .filter(
        (item) =>
          matchesQuickMemoSignature(item) && item.id !== QUICK_MEMO_DOC_ID,
      )
      .sort((a, b) => {
        const contentDiff =
          Number(quickMemoHasContent(b)) - Number(quickMemoHasContent(a));
        if (contentDiff !== 0) return contentDiff;
        return quickMemoUpdatedAtMs(b) - quickMemoUpdatedAtMs(a);
      })[0] || null
  );
}

function canonicalQuickMemoItem(items = state.items) {
  const fixed = items.find((item) => item.id === QUICK_MEMO_DOC_ID) || null;
  const legacy = bestLegacyQuickMemoItem(items);
  if (fixed && quickMemoHasContent(fixed)) return fixed;
  if (legacy && quickMemoHasContent(legacy)) return legacy;
  return fixed || legacy || null;
}

function updateQuickMemoStateFromItems() {
  const found = canonicalQuickMemoItem(state.items);
  state.quickMemoId = found?.id || QUICK_MEMO_DOC_ID;
  return found ? normalizeQuickMemoItem(found) : null;
}

function getQuickMemoItem() {
  if (state.quickMemoId) {
    const byId = state.items.find((item) => item.id === state.quickMemoId);
    if (byId) return normalizeQuickMemoItem(byId);
  }
  return updateQuickMemoStateFromItems();
}

function isQuickMemoItem(item) {
  if (!item) return false;
  if (state.quickMemoId && item.id === state.quickMemoId) return true;
  return matchesQuickMemoSignature(item);
}

function isQuickMemoSelected() {
  if (!state.selectedId) return false;
  if (state.quickMemoId && state.selectedId === state.quickMemoId) return true;
  const selected = state.items.find((memo) => memo.id === state.selectedId);
  return isQuickMemoItem(selected);
}

function currentQuickMemoStorageKind() {
  return normalizeStorageKind(
    getQuickMemoItem()?.storageKind,
    currentEditingStorageKind(),
  );
}

function firstMeaningfulBodyLine(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((row) => row.trim())
    .find(Boolean);
  return line || QUICK_MEMO_TITLE;
}

function quickMemoSavePayload(overrides = {}) {
  return {
    ...buildQuickMemoSeed(currentQuickMemoStorageKind()),
    memoBody: String(el.memoBodyInput.value || "").trim(),
    storageKind: currentQuickMemoStorageKind(),
    attachments: currentEditorAttachments(),
    ...overrides,
    projectName: QUICK_MEMO_PROJECT_NAME,
    memoType: QUICK_MEMO_MEMO_TYPE,
    threadTitle: QUICK_MEMO_TITLE,
    deletable: false,
    pinned: false,
  };
}

function isImageAttachment(item) {
  return (
    String(item?.kind || "").toLowerCase() === "image" ||
    String(item?.mimeType || "")
      .toLowerCase()
      .startsWith("image/")
  );
}

function attachmentsSnapshotValue() {
  return JSON.stringify(
    currentEditorAttachments().map((item) => ({
      id: item.id,
      fileName: item.fileName || "",
      mimeType: item.mimeType || "",
      size: Number(item.size || 0),
      caption: item.caption || "",
      width: item.width === undefined ? null : Number(item.width),
      height: item.height === undefined ? null : Number(item.height),
      storagePath: item.storagePath || "",
      hasDataUrl: Boolean(item.dataUrl),
    })),
  );
}

function formatAttachmentSize(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  if (value >= 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${Math.max(1, Math.round(value))}B`;
}

function attachmentStorageLabel(item) {
  if (item?.storagePath && /^memos\//.test(String(item.storagePath))) {
    return displayStorageKindLabel("firebase");
  }
  if (
    item?.storagePath &&
    /^\/(?:Users|tmp|var)\//.test(String(item.storagePath))
  ) {
    return displayStorageKindLabel("icloud");
  }
  return displayStorageKindLabel(currentEditingStorageKind());
}

function attachmentTooltipText(item) {
  return [
    item.fileName || item.id,
    item.width && item.height ? `${item.width}x${item.height}` : "",
    formatAttachmentSize(item.size),
    attachmentStorageLabel(item),
  ]
    .filter(Boolean)
    .join(" / ");
}

function bodyContainsAttachment(attachmentId) {
  const escapedId = String(attachmentId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `!?\\[[^\\]]*\\]\\(attachment:\\/\\/${escapedId}\\)`,
  );
  return pattern.test(String(el.memoBodyInput.value || ""));
}

function renderAttachmentList() {
  if (!el.attachmentList || !el.attachmentToggle) return;
  const attachments = currentEditorAttachments();
  el.attachmentList.innerHTML = "";
  if (!attachments.length) {
    state.attachmentListExpanded = false;
    el.attachmentToggle.classList.add("hidden");
    el.attachmentList.classList.add("hidden");
    el.attachmentList.classList.remove("flex");
    return;
  }
  const imageCount = attachments.filter(isImageAttachment).length;
  const fileCount = attachments.length - imageCount;
  const summaryParts = [
    ["Attachments ", attachments.length],
    ...(imageCount ? [[" · Images ", imageCount]] : []),
    ...(fileCount ? [[" · Files ", fileCount]] : []),
  ];
  el.attachmentToggle.replaceChildren();
  for (const [label, value] of summaryParts) {
    el.attachmentToggle.append(document.createTextNode(label));
    const strong = document.createElement("strong");
    strong.className = "font-bold text-[#56647d]";
    strong.textContent = String(value);
    el.attachmentToggle.append(strong);
  }
  el.attachmentToggle.append(
    document.createTextNode(` ${state.attachmentListExpanded ? "▾" : "▴"}`),
  );
  el.attachmentToggle.title = state.attachmentListExpanded
    ? "Hide attachments"
    : "Show attachments";
  el.attachmentToggle.setAttribute(
    "aria-expanded",
    String(state.attachmentListExpanded),
  );
  el.attachmentToggle.classList.remove("hidden");
  el.attachmentList.classList.toggle("hidden", !state.attachmentListExpanded);
  el.attachmentList.classList.toggle("flex", state.attachmentListExpanded);

  attachments.forEach((item) => {
    const chip = document.createElement("div");
    chip.className =
      "inline-flex max-w-full items-center gap-0.5 rounded-md border border-[#e6dfd5] bg-[#fffefd] px-1 py-0.5 text-[10px] leading-none text-[#5e6f8d]";
    chip.title = attachmentTooltipText(item);

    const thumbUrl = attachmentPreviewUrl(item);
    if (thumbUrl && isImageAttachment(item)) {
      const thumb = document.createElement("img");
      thumb.src = thumbUrl;
      thumb.alt = item.caption || item.fileName || item.id;
      thumb.className = "h-3.5 w-3.5 rounded-[3px] object-cover";
      thumb.title = chip.title;
      chip.appendChild(thumb);
    }

    if (!isImageAttachment(item)) {
      const icon = document.createElement("span");
      icon.className =
        "inline-flex h-3.5 min-w-[1.1rem] items-center justify-center rounded-[3px] bg-[#eef2f8] px-1 text-[8px] font-semibold uppercase text-[#60708d]";
      const ext = String(item.fileName || "")
        .split(".")
        .pop();
      icon.textContent = (ext && ext !== item.fileName ? ext : "file").slice(
        0,
        4,
      );
      icon.title = chip.title;
      chip.appendChild(icon);
    }

    const label = document.createElement("span");
    label.className = "max-w-[110px] truncate leading-none";
    label.textContent = item.fileName || item.caption || item.id;
    label.title = chip.title;
    chip.appendChild(label);

    const resolvedUrl = attachmentPreviewUrl(item);
    if (resolvedUrl) {
      const openLink = document.createElement("a");
      openLink.href = resolvedUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.className =
        "inline-flex h-4 items-center rounded px-1 text-[#5a7aab] hover:text-[#476998] hover:underline";
      openLink.textContent = isImageAttachment(item) ? "Open" : "Download";
      openLink.title = `${isImageAttachment(item) ? "Open" : "Download"} ${item.fileName || item.id}`;
      chip.appendChild(openLink);
    }

    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.className =
      "inline-flex h-4 w-4 items-center justify-center rounded text-[#6f7f9b] hover:text-[#5a6f94]";
    insertBtn.textContent = "+";
    insertBtn.title = bodyContainsAttachment(item.id)
      ? "Attachment already inserted"
      : `Insert ${isImageAttachment(item) ? "image" : "file"} into body`;
    insertBtn.disabled = isReadOnlyPanelSelected() || isQuickMemoSelected();
    insertBtn.addEventListener("click", () => {
      insertAttachmentMarkdown(item);
      updateSaveButtonState();
      renderAttachmentList();
      if (getBodyMode() === "preview") {
        renderMarkdownPreview();
      }
      el.memoBodyInput.focus();
      setStatus(`Inserted attachment: ${item.fileName || item.id}`);
    });
    chip.appendChild(insertBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className =
      "inline-flex h-4 w-4 items-center justify-center rounded text-[#9c6b7e] hover:text-[#cf7896]";
    removeBtn.textContent = "x";
    removeBtn.title = "Remove attachment";
    removeBtn.disabled = isReadOnlyPanelSelected() || isQuickMemoSelected();
    removeBtn.addEventListener("click", () => {
      state.editorAttachments = currentEditorAttachments().filter(
        (attachment) => attachment.id !== item.id,
      );
      removeAttachmentMarkdown(item.id);
      updateSaveButtonState();
      renderAttachmentList();
      if (getBodyMode() === "preview") {
        renderMarkdownPreview();
      }
      setStatus(`Removed attachment: ${item.fileName || item.id}`);
    });
    chip.appendChild(removeBtn);
    el.attachmentList.appendChild(chip);
  });
}

function escapeMarkdownLinkLabel(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\]/g, "\\]");
}

function escapeMarkdownLinkTarget(value) {
  return String(value || "").replace(/\)/g, "%29");
}

function insertAttachmentMarkdown(item) {
  const label = escapeMarkdownLinkLabel(
    item.caption || item.fileName || item.id,
  );
  const target = escapeMarkdownLinkTarget(`attachment://${item.id}`);
  const token = isImageAttachment(item)
    ? `![${label}](${target})`
    : `[${label}](${target})`;
  if (bodyContainsAttachment(item.id)) return;
  insertEditorToken(token);
}

function insertEditorToken(token) {
  const input = el.memoBodyInput;
  const start = Number.isInteger(input.selectionStart)
    ? input.selectionStart
    : input.value.length;
  const end = Number.isInteger(input.selectionEnd)
    ? input.selectionEnd
    : input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const joinBefore = before && !before.endsWith("\n") ? "\n" : "";
  const joinAfter = after && !after.startsWith("\n") ? "\n" : "";
  input.value = `${before}${joinBefore}${token}${joinAfter}${after}`;
  const cursor = before.length + joinBefore.length + token.length;
  input.selectionStart = cursor;
  input.selectionEnd = cursor;
}

function removeAttachmentMarkdown(attachmentId) {
  const escapedId = String(attachmentId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `!?\\[[^\\]]*\\]\\(attachment:\\/\\/${escapedId}\\)\\n?`,
    "g",
  );
  el.memoBodyInput.value = String(el.memoBodyInput.value || "")
    .replace(pattern, "")
    .replace(/\n{3,}/g, "\n\n");
}

function loadImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || undefined,
        height: img.naturalHeight || undefined,
      });
    img.onerror = () => resolve({ width: undefined, height: undefined });
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => {
    const mimeType = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return (
      mimeType.startsWith("image/") ||
      mimeType === "application/pdf" ||
      name.endsWith(".pdf")
    );
  });
  if (!files.length) {
    setStatus("Image or PDF file not found", true);
    return;
  }

  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const isImage = String(file.type || "").startsWith("image/");
    const dimensions = isImage
      ? await loadImageDimensions(dataUrl)
      : { width: undefined, height: undefined };
    const attachment = normalizeEditorAttachment({
      id: generateAttachmentId(),
      kind: isImage ? "image" : "file",
      fileName: file.name || "",
      mimeType:
        file.type ||
        (String(file.name || "")
          .toLowerCase()
          .endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream"),
      size: Number(file.size || 0),
      caption: file.name ? String(file.name).replace(/\.[^.]+$/, "") : "",
      width: dimensions.width,
      height: dimensions.height,
      dataUrl,
    });
    state.editorAttachments = [...currentEditorAttachments(), attachment];
    insertAttachmentMarkdown(attachment);
  }

  renderAttachmentList();
  updateSaveButtonState();
  if (getBodyMode() === "preview") {
    renderMarkdownPreview();
  }
  setStatus(`Added ${files.length} attachment${files.length > 1 ? "s" : ""}`);
}

function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer || !dataTransfer.files) return [];
  return Array.from(dataTransfer.files).filter((file) => {
    const mimeType = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    return (
      mimeType.startsWith("image/") ||
      mimeType === "application/pdf" ||
      name.endsWith(".pdf")
    );
  });
}

function dataTransferTypeList(dataTransfer) {
  if (!dataTransfer || !dataTransfer.types) return [];
  return Array.from(dataTransfer.types).map((type) =>
    String(type || "").toLowerCase(),
  );
}

function hasUrlDataTransferType(dataTransfer) {
  const types = dataTransferTypeList(dataTransfer);
  if (types.includes("text/uri-list") || types.includes("public.url"))
    return true;
  return Boolean(
    extractDroppedUrl(readDataTransferValue(dataTransfer, "text/plain")),
  );
}

function readDataTransferValue(dataTransfer, type) {
  if (!dataTransfer || typeof dataTransfer.getData !== "function") return "";
  try {
    return String(dataTransfer.getData(type) || "").trim();
  } catch {
    return "";
  }
}

function extractDroppedUrl(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return lines.find((line) => isDroppableUrl(line)) || "";
}

function isDroppableUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeHtmlEntities(text) {
  if (!text) return "";
  const textarea = document.createElement("textarea");
  textarea.innerHTML = String(text);
  return textarea.value.trim();
}

function stripHtmlTags(text) {
  return decodeHtmlEntities(String(text || "").replace(/<[^>]+>/g, " "));
}

function extractHtmlAnchorPayload(rawHtml) {
  const html = String(rawHtml || "").trim();
  if (!html) return null;
  const anchorMatch = html.match(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!anchorMatch) return null;
  const url = extractDroppedUrl(anchorMatch[2]);
  if (!url) return null;
  const label = stripHtmlTags(anchorMatch[3]).replace(/\s+/g, " ").trim();
  return {
    url,
    label,
  };
}

function droppedUrlPayload(dataTransfer) {
  const htmlPayload = extractHtmlAnchorPayload(
    readDataTransferValue(dataTransfer, "text/html"),
  );
  const plainText = readDataTransferValue(dataTransfer, "text/plain");
  const url =
    htmlPayload?.url ||
    extractDroppedUrl(
      readDataTransferValue(dataTransfer, "text/uri-list") ||
        readDataTransferValue(dataTransfer, "public.url") ||
        plainText,
    );
  if (!url) return null;

  const titleCandidate =
    htmlPayload?.label ||
    readDataTransferValue(dataTransfer, "public.url-name") ||
    plainText;
  const label =
    titleCandidate &&
    titleCandidate !== url &&
    !extractDroppedUrl(titleCandidate)
      ? titleCandidate
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) || ""
      : "";

  return {
    url,
    label,
  };
}

function insertDroppedUrlLink(dataTransfer) {
  const payload = droppedUrlPayload(dataTransfer);
  if (!payload) return false;
  const token = payload.label
    ? `[${escapeMarkdownLinkLabel(payload.label)}](${escapeMarkdownLinkTarget(payload.url)})`
    : payload.url;
  insertEditorToken(token);
  updateSaveButtonState();
  if (getBodyMode() === "preview") {
    renderMarkdownPreview();
  }
  setStatus(`Inserted link: ${payload.label || payload.url}`);
  return true;
}

function setDropHint(active) {
  const next = Boolean(active);
  el.memoBodyInput.classList.toggle("border-[#8ba2c7]", next);
  el.memoPreview.classList.toggle("border-[#8ba2c7]", next);
  el.memoPreview.classList.toggle("bg-[#fcfbf8]", next);
}

function ensureAttachmentLightbox() {
  if (attachmentLightbox) return attachmentLightbox;
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-[120] hidden items-center justify-center bg-[rgba(20,24,31,0.72)] px-6 py-6";
  overlay.innerHTML = [
    '<button type="button" data-lightbox-close="1" class="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] text-sm text-white">x</button>',
    '<img data-lightbox-image="1" alt="" class="max-h-full max-w-full rounded-lg border border-[rgba(255,255,255,0.16)] bg-white/5 object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]" />',
  ].join("");
  overlay.addEventListener("click", (ev) => {
    if (
      ev.target === overlay ||
      ev.target.closest("[data-lightbox-close='1']")
    ) {
      overlay.classList.add("hidden");
      overlay.classList.remove("flex");
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !overlay.classList.contains("hidden")) {
      overlay.classList.add("hidden");
      overlay.classList.remove("flex");
    }
  });
  document.body.appendChild(overlay);
  attachmentLightbox = {
    overlay,
    image: overlay.querySelector("[data-lightbox-image='1']"),
  };
  return attachmentLightbox;
}

function showAttachmentLightbox(src, alt) {
  if (!src) return;
  const lightbox = ensureAttachmentLightbox();
  lightbox.image.src = src;
  lightbox.image.alt = alt || "attachment";
  lightbox.overlay.classList.remove("hidden");
  lightbox.overlay.classList.add("flex");
}

function canAcceptEditorImageInput() {
  return !isReadOnlyPanelSelected();
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
  return (
    isUsageOverviewPanelSelected() ||
    isUsagePanelSelected() ||
    isCodexUsagePanelSelected()
  );
}

function isSpecialPanelId(id) {
  return (
    id === USAGE_OVERVIEW_PANEL_ID ||
    id === USAGE_PANEL_ID ||
    id === CODEX_USAGE_PANEL_ID
  );
}

function formatPercent(value, digits = 3) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "-";
}

function formatUsd(value, digits = 2) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? `$${n.toFixed(digits)}` : "-";
}

function formatJpy(value, digits = 0) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return `¥${n.toFixed(digits)}`;
}

function formatNumberCompact(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = n / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  const digits = current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(digits)} ${units[index]}`;
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

function getUsageStatsLatestFetchedAtISO() {
  const fsISO = state.usageFetchedAtISO || state.usageSummary?.endTime || "";
  const codexISO =
    state.codexUsageFetchedAtISO || state.codexUsageSummary?.fetchedAtISO || "";
  const storageISO =
    state.storageUsageFetchedAtISO ||
    state.storageUsageSummary?.fetchedAtISO ||
    "";
  const openaiISO =
    state.openaiCostsFetchedAtISO ||
    state.openaiCostsSummary?.fetchedAtISO ||
    "";
  const candidates = [fsISO, codexISO, storageISO, openaiISO]
    .map((value) => ({ value, ms: value ? new Date(value).getTime() : NaN }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => b.ms - a.ms);
  if (candidates.length) {
    return candidates[0].value;
  }
  return "";
}

function boldPercent(value, digits = 1) {
  return `**${formatPercent(value, digits)}**`;
}

function formatPeakPaceMetric(label, value) {
  return `${label} ${boldPercent(value, 0)}`;
}

function quoteMarkdownLines(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => String(line).replace(/^\s*>\s?/, ""))
    .map((line) => `> ${line}`);
}

function quoteUsageOverviewSummaryModelLine(modelName) {
  const model = String(modelName || "").trim();
  if (!model) return [];
  return [`> model: \`${model.replace(/`/g, "'")}\``];
}

function getUsageOverviewSummaryKey() {
  if (!state.usageSummary || !state.codexUsageSummary) return "";
  const fsPerDay = Array.isArray(state.usageSummary.perDay)
    ? state.usageSummary.perDay
    : [];
  const last = fsPerDay[fsPerDay.length - 1] || null;
  return JSON.stringify({
    fsEnd: state.usageSummary.endTime || "",
    fsLastDate: last?.date || "",
    fsLastTotal: Number(last?.total || 0),
    storageFetched: state.storageUsageSummary?.fetchedAtISO || "",
    storageBytes: Number(state.storageUsageSummary?.current?.totalBytes || 0),
    storageEgress30d: Number(
      state.storageUsageSummary?.last30d?.egressBytes || 0,
    ),
    openaiFetched: state.openaiCostsSummary?.fetchedAtISO || "",
    openaiTotalUsd30d: Number(state.openaiCostsSummary?.totalUsd30d || 0),
    codexFetched: state.codexUsageSummary.fetchedAtISO || "",
    codexWeeklyReset:
      state.codexUsageSummary?.secondaryWindow?.resetAtISO || "",
    codexWeeklyRemaining: Number(
      state.codexUsageSummary?.secondaryWindow?.remainingPercent ?? -1,
    ),
    roughUsdMonthly: Number(getRoughMonthlyCostSnapshot().totalUsd || 0),
  });
}

async function refreshUsageOverviewSummaryIfNeeded(options = {}) {
  const forceReload = Boolean(options.forceReload);
  if (!state.usageSummary || !state.codexUsageSummary) return;
  if (state.usageError || state.codexUsageError) return;
  const key = getUsageOverviewSummaryKey();
  if (!key) return;
  if (
    !forceReload &&
    state.usageOverviewAiSummaryKey === key &&
    (state.usageOverviewAiSummary || state.usageOverviewAiSummaryError)
  ) {
    return;
  }
  if (!forceReload && usageOverviewSummaryInFlight)
    return usageOverviewSummaryInFlight;

  usageOverviewSummaryInFlight = (async () => {
    try {
      const result = await request("/api/usage/overview-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firestoreSummary: state.usageSummary,
          codexSummary: state.codexUsageSummary,
          storageSummary: state.storageUsageSummary,
          openaiSummary: state.openaiCostsSummary,
          roughCostSummary: getRoughMonthlyCostSnapshot(),
        }),
      });
      state.usageOverviewAiSummary = String(result.summary || "").trim();
      state.usageOverviewAiSummaryModel = String(result.model || "").trim();
      renderSummaryButtonTooltip(state.usageOverviewAiSummaryModel);
      state.usageOverviewAiSummaryError = "";
      state.usageOverviewAiSummaryKey = key;
    } catch (error) {
      state.usageOverviewAiSummary = "";
      state.usageOverviewAiSummaryModel = "";
      renderSummaryButtonTooltip("");
      state.usageOverviewAiSummaryError = String(
        error.message || error || "Failed to summarize usage overview",
      );
      state.usageOverviewAiSummaryKey = key;
    } finally {
      if (state.selectedId === USAGE_OVERVIEW_PANEL_ID) {
        fillEditor(buildUsageOverviewPanelItem({ forceRebuild: true }), {
          fromCache: false,
        });
      }
    }
  })().finally(() => {
    usageOverviewSummaryInFlight = null;
  });

  return usageOverviewSummaryInFlight;
}

function applyPressureBadgeBorder(elm, usedPercent) {
  const v = Math.max(0, Math.min(100, Number(usedPercent || 0)));
  elm.classList.remove(
    "border-[#7fb08a]",
    "border-[#d6a56a]",
    "border-[#d28b99]",
    "bg-[#fdecef]",
  );
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
  const perDay = Array.isArray(state.usageSummary?.perDay)
    ? state.usageSummary.perDay
    : [];
  const today = perDay.find((d) => d.date === todayKey) ||
    perDay[perDay.length - 1] || {
      read: 0,
      write: 0,
      delete: 0,
      date: todayKey,
    };
  const recent = perDay.slice(-14);
  const recentExcludingToday = recent.filter(
    (d) => String(d?.date || "") !== String(today?.date || ""),
  );
  const limits = state.usageSummary?.limitsDaily || {
    read: 50000,
    write: 20000,
    delete: 20000,
  };
  const ratePercent = {
    read: Number(
      today?.ratePercent?.read ??
        (Number(today.read || 0) / Math.max(1, Number(limits.read || 1))) * 100,
    ),
    write: Number(
      today?.ratePercent?.write ??
        (Number(today.write || 0) / Math.max(1, Number(limits.write || 1))) *
          100,
    ),
    delete: Number(
      today?.ratePercent?.delete ??
        (Number(today.delete || 0) / Math.max(1, Number(limits.delete || 1))) *
          100,
    ),
  };
  const maxInRecent = {
    read: Math.max(1, ...recentExcludingToday.map((d) => Number(d.read || 0))),
    write: Math.max(
      1,
      ...recentExcludingToday.map((d) => Number(d.write || 0)),
    ),
    delete: Math.max(
      1,
      ...recentExcludingToday.map((d) => Number(d.delete || 0)),
    ),
  };
  const relativePercent = {
    read:
      (Number(today.read || 0) / Math.max(1, Number(maxInRecent.read || 1))) *
      100,
    write:
      (Number(today.write || 0) / Math.max(1, Number(maxInRecent.write || 1))) *
      100,
    delete:
      (Number(today.delete || 0) /
        Math.max(1, Number(maxInRecent.delete || 1))) *
      100,
  };
  return { today, ratePercent, relativePercent };
}

function getFirestoreActivitySnapshot() {
  const rows = Array.isArray(state.usageSummary?.perDay)
    ? state.usageSummary.perDay.slice(-14)
    : [];
  const totalFor = (key) =>
    rows.reduce((sum, row) => sum + Number(row?.[key] || 0), 0);
  const peakFor = (key) =>
    rows.reduce(
      (peak, row) =>
        Number(row?.[key] || 0) > Number(peak?.value || 0)
          ? { date: row?.date || "-", value: Number(row?.[key] || 0) }
          : peak,
      { date: "-", value: 0 },
    );
  const days = Math.max(1, rows.length);
  return {
    days: rows.length,
    read: { total: totalFor("read"), avg: totalFor("read") / days, peak: peakFor("read") },
    write: { total: totalFor("write"), avg: totalFor("write") / days, peak: peakFor("write") },
    delete: { total: totalFor("delete"), avg: totalFor("delete") / days, peak: peakFor("delete") },
  };
}

function getStorageSnapshot() {
  const summary = state.storageUsageSummary || null;
  const estimate = summary?.estimate || {};
  const percent = estimate.percentOfNoCost || {};
  const noCost = summary?.noCost || {};
  const peak = Math.max(
    Number(percent.storage || 0),
    Number(percent.download || 0),
    Number(percent.classA || 0),
    Number(percent.classB || 0),
  );
  return {
    peakPercent: peak,
    bytes: Number(summary?.current?.totalBytes || 0),
    objects: Number(summary?.current?.totalObjects || 0),
    egressBytes30d: Number(summary?.last30d?.egressBytes || 0),
    storageLimitGb: Number(noCost.storageGbMonths || 0),
    requestCounts: summary?.last30d?.requestCounts || {
      classA: 0,
      classB: 0,
      other: 0,
      total: 0,
    },
    estimatedMonthlyUsd: Number(estimate.estimatedMonthlyUsd || 0),
    bucketKind: summary?.bucketKind || "-",
    percentOfNoCost: {
      storage: Number(percent.storage || 0),
      download: Number(percent.download || 0),
      classA: Number(percent.classA || 0),
      classB: Number(percent.classB || 0),
    },
  };
}

function getOpenAISnapshot() {
  const summary = state.openaiCostsSummary || null;
  const budgetJpy = Number(summary?.budgetReference?.amountJpy || 0);
  const totalUsd = Number(summary?.totalUsd30d || 0);
  return {
    available: Boolean(summary?.available),
    totalUsd30d: totalUsd,
    latestDayUsd: Number(summary?.latestDayUsd || 0),
    budgetJpy,
    budgetStateText:
      budgetJpy > 0
        ? `${formatUsd(totalUsd, 2)} / ref ¥${budgetJpy.toLocaleString()}`
        : formatUsd(totalUsd, 2),
  };
}

function simplifyOpenAILineItemName(name) {
  return String(name || "")
    .replace(/-\d{4}-\d{2}-\d{2}/g, "")
    .replace(/,\s*/g, " / ")
    .trim();
}

function splitOpenAILineItemName(name) {
  const simplified = simplifyOpenAILineItemName(name);
  const parts = simplified
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const kind = parts.pop();
    return {
      model: parts.join(" / "),
      kind,
    };
  }
  return {
    model: simplified,
    kind: "",
  };
}

function roundUsd(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function formatOpenAILineItems14d(lineItems, usdToJpy) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const grouped = new Map();
  items.forEach((item) => {
    const { model, kind } = splitOpenAILineItemName(item?.name || "");
    const amountUsd = roundUsd(Number(item?.amountUsd || 0), 3);
    if (amountUsd <= 0) return;
    const key = model || "other";
    const existing = grouped.get(key) || { model: key, entries: [] };
    existing.entries.push({
      kind: kind || "other",
      amountUsd,
    });
    grouped.set(key, existing);
  });
  const charged = Array.from(grouped.values())
    .map((group) => {
      const entries = group.entries
        .map((entry) => {
          const amountUsd = roundUsd(entry.amountUsd, 3);
          return {
            kind: entry.kind,
            amountUsd,
            amountJpy: Math.round(amountUsd * usdToJpy),
          };
        })
        .filter((entry) => entry.amountUsd > 0)
        .sort(
          (a, b) => b.amountUsd - a.amountUsd || a.kind.localeCompare(b.kind),
        );
      const totalUsd = roundUsd(
        entries.reduce((sum, entry) => sum + entry.amountUsd, 0),
        3,
      );
      return {
        model: group.model,
        totalUsd,
        entries,
      };
    })
    .filter((item) => item.totalUsd > 0)
    .sort((a, b) => b.totalUsd - a.totalUsd || a.model.localeCompare(b.model));
  if (!charged.length) return null;
  return charged;
}

function getRoughMonthlyCostSnapshot() {
  const storage = getStorageSnapshot();
  const openai = getOpenAISnapshot();
  const envRate = Number(state.runtimeConfig?.usdToJpy || 0);
  const usdToJpy = Number.isFinite(envRate) && envRate > 0 ? envRate : 150;
  const storageUsd = Number(storage.estimatedMonthlyUsd || 0);
  const openaiUsd = openai.available ? Number(openai.totalUsd30d || 0) : 0;
  return {
    totalUsd: storageUsd + openaiUsd,
    storageUsd,
    openaiUsd,
    totalJpy: (storageUsd + openaiUsd) * usdToJpy,
    storageJpy: storageUsd * usdToJpy,
    openaiJpy: openaiUsd * usdToJpy,
    usdToJpy,
  };
}

function getMonthPaceInfo(baseDate = new Date()) {
  const date = new Date(baseDate);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return {
    dayOfMonth: day,
    daysInMonth,
    elapsedRatio: day / Math.max(1, daysInMonth),
    remainingDays: Math.max(0, daysInMonth - day),
  };
}

function buildUsageOverviewSnapshot() {
  return {
    version: 1,
    usageSummary: state.usageSummary,
    usageError: state.usageError,
    usageFetchedAtISO: state.usageFetchedAtISO,
    storageUsageSummary: state.storageUsageSummary,
    storageUsageError: state.storageUsageError,
    storageUsageFetchedAtISO: state.storageUsageFetchedAtISO,
    openaiCostsSummary: state.openaiCostsSummary,
    openaiCostsError: state.openaiCostsError,
    openaiCostsFetchedAtISO: state.openaiCostsFetchedAtISO,
    codexUsageSummary: state.codexUsageSummary,
    codexUsageError: state.codexUsageError,
    codexUsageFetchedAtISO: state.codexUsageFetchedAtISO,
    usageOverviewAiSummary: state.usageOverviewAiSummary,
    usageOverviewAiSummaryModel: state.usageOverviewAiSummaryModel,
    usageOverviewAiSummaryError: state.usageOverviewAiSummaryError,
    usageOverviewAiSummaryKey: state.usageOverviewAiSummaryKey,
  };
}

function serializeUsageOverviewMemoBody(
  visibleBody,
  snapshot = buildUsageOverviewSnapshot(),
) {
  const body = String(visibleBody || "").trim();
  if (!snapshot) return body;
  return [
    body,
    "",
    `<!-- ${USAGE_OVERVIEW_SNAPSHOT_MARKER}`,
    JSON.stringify(snapshot, null, 2),
    "-->",
  ].join("\n");
}

function parseUsageOverviewMemoBody(rawMemoBody) {
  const raw = String(rawMemoBody || "");
  const matcher = new RegExp(
    `\\n?<!--\\s*${USAGE_OVERVIEW_SNAPSHOT_MARKER}\\s*\\n([\\s\\S]*?)\\n-->\\s*$`,
  );
  const match = raw.match(matcher);
  if (!match) {
    return {
      visibleBody: raw,
      snapshot: null,
    };
  }

  let snapshot = null;
  try {
    snapshot = JSON.parse(match[1]);
  } catch (error) {
    console.warn("[codex-memo] usage overview snapshot parse failed:", error);
  }

  return {
    visibleBody: raw.replace(matcher, "").trimEnd(),
    snapshot,
  };
}

function restoreUsageOverviewSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  state.usageSummary = snapshot.usageSummary || null;
  state.usageError = String(snapshot.usageError || "");
  state.usageFetchedAtISO = String(snapshot.usageFetchedAtISO || "");
  state.storageUsageSummary = snapshot.storageUsageSummary || null;
  state.storageUsageError = String(snapshot.storageUsageError || "");
  state.storageUsageFetchedAtISO = String(
    snapshot.storageUsageFetchedAtISO || "",
  );
  state.openaiCostsSummary = snapshot.openaiCostsSummary || null;
  state.openaiCostsError = String(snapshot.openaiCostsError || "");
  state.openaiCostsFetchedAtISO = String(
    snapshot.openaiCostsFetchedAtISO || "",
  );
  state.codexUsageSummary = snapshot.codexUsageSummary || null;
  state.codexUsageError = String(snapshot.codexUsageError || "");
  state.codexUsageFetchedAtISO = String(snapshot.codexUsageFetchedAtISO || "");
  state.usageOverviewAiSummary = String(snapshot.usageOverviewAiSummary || "");
  state.usageOverviewAiSummaryModel = String(
    snapshot.usageOverviewAiSummaryModel || "",
  );
  state.usageOverviewAiSummaryError = String(
    snapshot.usageOverviewAiSummaryError || "",
  );
  state.usageOverviewAiSummaryKey = String(
    snapshot.usageOverviewAiSummaryKey || "",
  );
  renderSummaryButtonTooltip(state.usageOverviewAiSummaryModel);
  return true;
}

function buildUsageOverviewBody() {
  return USAGE_OVERVIEW_SHARED.buildUsageOverviewBody({
    firestoreSummary: state.usageSummary,
    firestoreError: state.usageError,
    firestoreSnapshot: getFirestoreTodaySnapshot(),
    firestoreActivitySnapshot: getFirestoreActivitySnapshot(),
    storageSummary: state.storageUsageSummary,
    storageError: state.storageUsageError,
    storageSnapshot: getStorageSnapshot(),
    openaiSummary: state.openaiCostsSummary,
    openaiError: state.openaiCostsError,
    openaiSnapshot: getOpenAISnapshot(),
    codexSummary: state.codexUsageSummary,
    codexError: state.codexUsageError,
    roughCost: getRoughMonthlyCostSnapshot(),
    monthPace: getMonthPaceInfo(),
    usageOverviewSummary: state.usageOverviewAiSummary,
    usageOverviewSummaryModel: state.usageOverviewAiSummaryModel,
    interactiveRefs: true,
    helpers: {
      formatJpy,
      formatUsd,
      formatBytes,
      formatNumberCompact,
      boldPercent,
      formatPeakPaceMetric,
      formatDuration,
      formatDate,
      quoteMarkdownLines,
      quoteUsageOverviewSummaryModelLine,
      formatOpenAILineItems14d,
    },
  });
}

function buildUsageOverviewPanelItem(options = {}) {
  const persisted = state.persistedUsageOverview;
  if (!Boolean(options.forceRebuild) && persisted?.memoBody) {
    const parsed = parseUsageOverviewMemoBody(persisted.memoBody);
    return {
      id: USAGE_OVERVIEW_PANEL_ID,
      projectName: "system",
      memoType: "keep",
      threadTitle: "Usage overview",
      memoBody: parsed.visibleBody,
      createdAtISO: persisted.createdAtISO || "",
      updatedAtISO: persisted.updatedAtISO || "",
    };
  }
  return {
    id: USAGE_OVERVIEW_PANEL_ID,
    projectName: "system",
    memoType: "keep",
    threadTitle: "Usage overview",
    memoBody: buildUsageOverviewBody(),
    createdAtISO:
      state.codexUsageSummary?.fetchedAtISO ||
      state.usageSummary?.endTime ||
      "",
    updatedAtISO:
      state.codexUsageSummary?.fetchedAtISO ||
      state.usageSummary?.endTime ||
      "",
  };
}

function buildUsageBody(summary) {
  if (!summary) {
    return ["# Firestore usage", "", "usage data is not loaded yet."]
      .concat(usageSourceFooterLines())
      .join("\n");
  }

  const perDayRaw = Array.isArray(summary.perDay) ? summary.perDay : [];
  const perDayDesc = [...perDayRaw].sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")),
  );
  const today = perDayDesc[0] || {
    date: "-",
    read: 0,
    write: 0,
    delete: 0,
    ratePercent: {},
  };
  const todayRate = {
    read: Number(today?.ratePercent?.read || 0),
    write: Number(today?.ratePercent?.write || 0),
    delete: Number(today?.ratePercent?.delete || 0),
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
    "| --- | ---: | ---: | ---: | ---: |",
  ];

  for (const day of perDayDesc) {
    lines.push(
      `| ${day.date} | ${day.read || 0} | ${day.write || 0} | ${day.delete || 0} | ${day.total || 0} |`,
    );
  }

  if (summary.note) {
    lines.push("", summary.note);
  }

  lines.push(...usageSourceFooterLines());
  return lines.join("\n");
}

function buildUsagePanelItem(options = {}) {
  return {
    id: USAGE_PANEL_ID,
    projectName: "system",
    memoType: "keep",
    threadTitle: "Firestore usage",
    memoBody: buildUsageBody(state.usageSummary),
    createdAtISO: state.usageSummary?.endTime || "",
    updatedAtISO: state.usageSummary?.endTime || "",
  };
}

function buildCodexUsageBody(summary) {
  if (!summary) {
    return ["# Codex usage", "", "usage data is not loaded yet."]
      .concat(usageSourceFooterLines())
      .join("\n");
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
    ...usageSourceFooterLines(),
  ].join("\n");
}

function buildCodexUsagePanelItem(options = {}) {
  return {
    id: CODEX_USAGE_PANEL_ID,
    projectName: "system",
    memoType: "keep",
    threadTitle: "Codex usage",
    memoBody: buildCodexUsageBody(state.codexUsageSummary),
    createdAtISO: state.codexUsageSummary?.fetchedAtISO || "",
    updatedAtISO: state.codexUsageSummary?.fetchedAtISO || "",
  };
}

function renderDateWithCacheIndicator(value) {
  const formatted = formatDate(value);
  return state.selectedCacheHit ? `.${formatted}` : formatted;
}

function currentPayload() {
  if (isQuickMemoSelected()) {
    return quickMemoSavePayload();
  }
  if (isMarkdownCssMemoItem(selectedMemoItem())) {
    return {
      projectName: MARKDOWN_CSS_MEMO_PROJECT_NAME,
      memoType: MARKDOWN_CSS_MEMO_TYPE,
      threadTitle: MARKDOWN_CSS_MEMO_TITLE,
      memoBody: el.memoBodyInput.value.trim(),
      storageKind: currentEditingStorageKind(),
      attachments: [],
    };
  }
  return {
    projectName: el.projectNameInput.value.trim(),
    memoType: el.memoTypeInput.value,
    threadTitle: el.threadTitleInput.value.trim(),
    memoBody: el.memoBodyInput.value.trim(),
    storageKind: currentEditingStorageKind(),
    attachments: currentEditorAttachments(),
  };
}

function currentEditorSnapshot() {
  if (isMarkdownCssMemoItem(selectedMemoItem())) {
    return {
      projectName: MARKDOWN_CSS_MEMO_PROJECT_NAME,
      memoType: MARKDOWN_CSS_MEMO_TYPE,
      threadTitle: MARKDOWN_CSS_MEMO_TITLE,
      memoBody: el.memoBodyInput.value,
      storageKind: currentEditingStorageKind(),
      attachments: "",
    };
  }
  return {
    projectName: el.projectNameInput.value,
    memoType: el.memoTypeInput.value,
    threadTitle: el.threadTitleInput.value,
    memoBody: el.memoBodyInput.value,
    storageKind: currentEditingStorageKind(),
    attachments: attachmentsSnapshotValue(),
  };
}

function hasRequiredPayloadFields() {
  if (isQuickMemoSelected()) {
    return Boolean(el.memoBodyInput.value.trim());
  }
  if (isMarkdownCssMemoItem(selectedMemoItem())) {
    return Boolean(el.memoBodyInput.value.trim());
  }
  return Boolean(
    el.projectNameInput.value.trim() &&
    el.threadTitleInput.value.trim() &&
    el.memoBodyInput.value.trim(),
  );
}

function currentPayloadValidationError() {
  if (!hasRequiredPayloadFields()) {
    return isMarkdownCssMemoItem(selectedMemoItem())
      ? "memoBody is required"
      : "projectName / threadTitle / memoBody are required";
  }
  return "";
}

function isSameSnapshot(a, b) {
  if (!a || !b) return false;
  return (
    a.projectName === b.projectName &&
    a.memoType === b.memoType &&
    a.threadTitle === b.threadTitle &&
    a.memoBody === b.memoBody &&
    a.storageKind === b.storageKind &&
    a.attachments === b.attachments
  );
}

function hasUnsavedEditorChanges() {
  if (isReadOnlyPanelSelected()) return false;
  if (!state.editorBaseline) return false;
  return !isSameSnapshot(currentEditorSnapshot(), state.editorBaseline);
}

function confirmDiscardEditorChanges() {
  if (!hasUnsavedEditorChanges()) return true;
  return window.confirm("未保存の変更を破棄して移動する？");
}

async function upsertFixedMemo(id, payload) {
  const data = await request(`/api/memos/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...payload,
      createIfMissing: true,
    }),
  });
  return data.item;
}

function updateSaveButtonState() {
  if (isReadOnlyPanelSelected()) {
    el.saveBtn.disabled = true;
    return;
  }
  if (currentPayloadValidationError()) {
    el.saveBtn.disabled = true;
    return;
  }
  const dirty = !isSameSnapshot(currentEditorSnapshot(), state.editorBaseline);
  el.saveBtn.disabled = !dirty;
}

function renderStorageControls() {
  const config = currentRuntimeConfig();
  const allowed = currentAllowedAdapters();
  const selectedFilterKind = normalizeStorageKind(
    state.storageFilterKind || "",
    "",
  );
  el.modeBadge.textContent =
    config.storageMode === "fixed"
      ? displayStorageKindLabel(config.fixedAdapter)
      : "Mixed";
  const badgeTone = modeBadgeClass(config.fixedAdapter, config.storageMode);
  el.modeBadge.classList.remove(
    "border-[#b7aeca]",
    "bg-transparent",
    "text-[#8a5f74]",
    "border-[#c8ced6]",
    "text-[#5e6877]",
    "border-[#cfd4dd]",
    "text-[#7a8493]",
    "border-[#bdd1e8]",
    "text-[#5678a3]",
    "border-[#9eaecd]",
    "text-[#6e84ad]",
    "border-[#d6c3ac]",
    "text-[#8b6644]",
    "border-[#e2b1c2]",
    "text-[#cf7896]",
  );
  el.modeBadge.classList.add(badgeTone.border, badgeTone.bg, badgeTone.text);
  const tooltipLines =
    config.storageMode === "fixed"
      ? [
          `Mode: fixed`,
          `Storage: ${displayStorageKindLabel(config.fixedAdapter)}`,
          storagePathFor(config.fixedAdapter),
        ].filter(Boolean)
      : [
          "Mode: mixed",
          `Default: ${displayStorageKindLabel(currentDefaultStorageKind())}`,
          ...allowed.map(
            (kind) =>
              `${displayStorageKindLabel(kind)}: ${storagePathFor(kind)}`,
          ),
        ].filter(Boolean);
  el.modeBadge.title = tooltipLines.join("\n");

  el.storageFilterSelect.innerHTML = '<option value="">Storages</option>';
  for (const kind of allowed) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = displayStorageKindLabel(kind);
    el.storageFilterSelect.appendChild(option);
  }
  if (selectedFilterKind && allowed.includes(selectedFilterKind)) {
    el.storageFilterSelect.value = selectedFilterKind;
  } else {
    el.storageFilterSelect.value = "";
    state.storageFilterKind = "";
  }

  el.defaultStorageSelect.innerHTML = "";
  for (const kind of config.availableAdapters || []) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = displayStorageKindLabel(kind);
    option.disabled = !allowed.includes(kind);
    el.defaultStorageSelect.appendChild(option);
  }
  el.defaultStorageSelect.value = currentDefaultStorageKind();
  const showSelector = allowed.length > 1;
  const showDefaultSelector = showSelector && !state.selectedId;
  const editableStorageOptions = currentEditableStorageOptions();
  const selectedMemo = state.items.find((memo) => memo.id === state.selectedId);
  const selectedStorageKind = normalizeStorageKind(
    selectedMemo?.storageKind,
    "",
  );
  const showEditSelector = Boolean(
    state.selectedId &&
    !isQuickMemoSelected() &&
    !isSpecialPanelId(state.selectedId) &&
    config.storageMode === "mixed" &&
    editableStorageOptions.length > 1 &&
    (selectedStorageKind === "icloud" || selectedStorageKind === "firebase"),
  );
  el.storageFilterWrap.classList.toggle("hidden", !showSelector);
  el.storageFilterSelect.disabled = !showSelector;
  el.defaultStorageWrap.classList.toggle("hidden", !showDefaultSelector);
  el.defaultStorageSelect.disabled = !showDefaultSelector;

  el.editStorageSelect.innerHTML = "";
  for (const kind of editableStorageOptions) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = displayStorageKindLabel(kind);
    el.editStorageSelect.appendChild(option);
  }
  el.editStorageSelect.value = currentEditingStorageKind();
  el.editStorageWrap.classList.toggle("hidden", !showEditSelector);
  el.editStorageSelect.disabled = !showEditSelector;
}

function launchCommandLinesForCurrentMode() {
  const config = currentRuntimeConfig();
  if (config.storageMode === "fixed") {
    switch (normalizeStorageKind(config.fixedAdapter)) {
      case "icloud":
        return ["npm run memo:web:icloud"];
      default:
        return ["npm run memo:web:firebase"];
    }
  }
  return [
    "npm run memo:web",
    "npm run memo:web:icloud",
    "npm run memo:web:firebase",
  ];
}

async function showModeLaunchHint() {
  const lines = launchCommandLinesForCurrentMode();
  const message = ["Launch commands", ...lines].join("\n");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(lines.join("\n"));
      setStatus("Copied launch command", false, "force");
    } else {
      setStatus("Launch command shown", false, "force");
    }
  } catch (_error) {
    setStatus("Launch command shown", false, "force");
  }
  window.alert(message);
}

function renderStorageInfo(item) {
  el.storageInfo.textContent = "";
  el.storageInfo.className = "hidden";
}

function selectedMemoItem() {
  if (!state.selectedId || isSpecialPanelId(state.selectedId)) return null;
  return state.items.find((memo) => memo.id === state.selectedId) || null;
}

function renderEditorDividerAccent(storageKind = "") {
  if (!el.editorDivider) return;
  el.editorDivider.className = "mb-2 mt-1 border-t-2";
  if (isQuickMemoSelected()) {
    el.editorDivider.classList.add("border-[#d68e25]");
    return;
  }
  const selected = selectedMemoItem();
  if (selected?.pinned) {
    const pinnedKind = normalizeStorageKind(selected.storageKind, storageKind);
    el.editorDivider.className = "mb-2 mt-1 border-t-2";
    if (pinnedKind === "icloud") {
      el.editorDivider.classList.add("border-[#5f7fb8]");
      return;
    }
    if (pinnedKind === "firebase") {
      el.editorDivider.classList.add("border-[#d96f98]");
      return;
    }
    el.editorDivider.classList.add("border-[#d68e25]");
    return;
  }
  const kind = normalizeStorageKind(storageKind, "");
  if (kind === "icloud") {
    el.editorDivider.classList.add("border-[#9eaecd]");
    return;
  }
  if (kind === "firebase") {
    el.editorDivider.classList.add("border-[#e2b1c2]");
    return;
  }
  el.editorDivider.classList.add("border-[#ece7df]");
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const LOCAL_PATH_REGEX =
  /(?:\/Users|\/tmp|\/var)\/(?:[^\s"'`<>:]+(?: [^\s"'`<>:]+)*\/)*(?:[^\s"'`<>:]+(?: [^\s"'`<>:]+)*\.[A-Za-z0-9]{1,12})(?::\d+(?:-\d+)?(?:[,\s]+\d+(?:-\d+)?)*)?/gi;
const LOCAL_PATH_TOKEN_REGEX =
  /^\/(?:Users|tmp|var)\/(?:[^\s"'`<>:]+(?: [^\s"'`<>:]+)*\/)*(?:[^\s"'`<>:]+(?: [^\s"'`<>:]+)*\.[A-Za-z0-9]{1,12})(?::\d+(?:-\d+)?(?:[,\s]+\d+(?:-\d+)?)*)?$/i;

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
    const cleaned = String(match[0] || "")
      .trim()
      .replace(/[),.;!?]+$/, "");
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
  return (
    extractLinks(text).length > 0 ||
    extractLocalPaths(text).length > 0 ||
    /\[[^\]]+\]\(attachment:\/\/[A-Za-z0-9._-]+\)/.test(String(text || ""))
  );
}

function hasBodyImage(item) {
  const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
  if (attachments.some((attachment) => isImageAttachment(attachment)))
    return true;
  return /!\[[^\]]*\]\((?:attachment:\/\/|https?:\/\/|\/)/.test(
    String(item?.memoBody || ""),
  );
}

function normalizePathToken(raw) {
  return String(raw || "")
    .replace(/^[("'`[\{<]+/, "")
    .replace(/[)"'`\]}>.,;!?]+$/, "")
    .trim();
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
  LOCAL_PATH_REGEX.lastIndex = 0;
  let pathMatch = LOCAL_PATH_REGEX.exec(source);
  while (pathMatch) {
    const start = Number(pathMatch.index || 0);
    const end = start + String(pathMatch[0] || "").length;
    if (index >= start && index <= end) {
      return normalizePathToken(pathMatch[0]);
    }
    pathMatch = LOCAL_PATH_REGEX.exec(source);
  }
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
    body: JSON.stringify({ path: normalized, originalPath: requested }),
  });
  setStatus(
    `Opened: ${data.openedPath || data.path || normalized}`,
    false,
    "force",
  );
}

async function openFontBookApp() {
  let lastError = null;
  for (const candidate of FONT_BOOK_APP_CANDIDATES) {
    try {
      await openLocalPath(candidate);
      return true;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Font Book.app not found.");
}

async function tryOpenPathAtCursor() {
  const token = tokenAtCursor(
    el.memoBodyInput.value || "",
    el.memoBodyInput.selectionStart || 0,
  );
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
    if (USAGE_REF_PAGE_URLS.includes(href)) {
      anchor.classList.add("usage-ref-link");
    }
  });
}

function openUsageRefs() {
  USAGE_REF_PAGE_URLS.forEach((url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function markdownToHtml(source) {
  let html = "";
  const markedLib = window.marked;
  if (markedLib) {
    const parseOptions = { gfm: true, breaks: true };
    if (
      typeof markedLib.parse === "function" &&
      typeof markedLib.lexer === "function" &&
      typeof markedLib.parser === "function" &&
      typeof markedLib.Renderer === "function"
    ) {
      const annotateListMarkers = (tokens) => {
        if (!Array.isArray(tokens)) return;
        tokens.forEach((token) => {
          if (!token || typeof token !== "object") return;
          if (token.type === "list" && !token.ordered) {
            const firstItem = Array.isArray(token.items)
              ? token.items[0]
              : null;
            const itemRaw = String(firstItem?.raw || "");
            const tokenRaw = String(token.raw || "");
            const marker =
              String(firstItem?.bullet || "") ||
              itemRaw.match(/^\s*([*+-])\s/m)?.[1] ||
              tokenRaw.match(/^\s*([*+-])\s/m)?.[1] ||
              "";
            if (marker) token._codexListMarker = marker;
          }
          if (Array.isArray(token.tokens)) annotateListMarkers(token.tokens);
          if (Array.isArray(token.items)) {
            token.items.forEach((item) => {
              if (Array.isArray(item?.tokens)) annotateListMarkers(item.tokens);
            });
          }
        });
      };

      const tokens = markedLib.lexer(source || "", parseOptions);
      annotateListMarkers(tokens);

      const renderer = new markedLib.Renderer();
      if (typeof renderer.list === "function") {
        const baseList = renderer.list.bind(renderer);
        renderer.list = function listWithMarkerClass(token, ...rest) {
          const rendered = baseList(token, ...rest);
          if (!token || token.ordered || typeof rendered !== "string")
            return rendered;
          const marker = String(token._codexListMarker || "");
          const cls =
            marker === "-"
              ? "md-list-dash"
              : marker === "*"
                ? "md-list-bullet"
                : "";
          if (!cls) return rendered;
          return rendered.replace(/^<ul>/, `<ul class="${cls}">`);
        };
      }

      html = markedLib.parser(tokens, { ...parseOptions, renderer });
    } else if (typeof markedLib.parse === "function") {
      html = markedLib.parse(source, parseOptions);
    } else if (typeof markedLib === "function") {
      html = markedLib(source, parseOptions);
    }
  } else {
    html = `<pre>${escapeHtml(source)}</pre>`;
  }
  if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
    // Preserve internal attachment:// URLs so preview can swap them to signed/local URLs later.
    html = window.DOMPurify.sanitize(html, {
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto|ftp|tel|attachment|message):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    });
  }
  return html || "<p></p>";
}

function applyAttachmentPreviewLinks(root) {
  if (!root) return;
  const attachments = new Map(
    currentEditorAttachments().map((item) => [item.id, item]),
  );
  root.querySelectorAll("img, a").forEach((node) => {
    const attr = node.tagName === "IMG" ? "src" : "href";
    const raw = String(node.getAttribute(attr) || "").trim();
    const match = raw.match(/^attachment:\/\/([A-Za-z0-9._-]+)$/);
    if (!match) return;
    const attachment = attachments.get(String(match[1]));
    const resolved = attachmentPreviewUrl(attachment);
    if (!resolved) return;
    node.setAttribute(attr, resolved);
    if (node.tagName === "A") {
      node.setAttribute("data-attachment-link", "true");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

function applyMarkdownTableAlignments(root) {
  if (!root) return;
  root.querySelectorAll("th, td").forEach((cell) => {
    const align = String(cell.getAttribute("align") || "")
      .trim()
      .toLowerCase();
    if (align === "left" || align === "center" || align === "right") {
      cell.style.textAlign = align;
    }
  });
}

function initializeMermaidRenderer() {
  if (mermaidInitialized) return true;
  const mermaid = window.mermaid;
  if (!mermaid || typeof mermaid.initialize !== "function") return false;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: "#fefdfb",
      primaryColor: "#ffffff",
      primaryTextColor: "#4b5568",
      primaryBorderColor: "#c9ced7",
      lineColor: "#6e7d99",
      secondaryColor: "#ffffff",
      tertiaryColor: "#ffffff",
    },
  });
  mermaidInitialized = true;
  return true;
}

function prepareMermaidBlocks(root) {
  if (!root) return [];
  const blocks = [];
  root
    .querySelectorAll("pre > code.language-mermaid, pre > code.lang-mermaid")
    .forEach((code) => {
      const pre = code.parentElement;
      if (!pre || pre.dataset.mermaidPrepared === "true") return;
      const diagram = document.createElement("div");
      diagram.className = "mermaid";
      diagram.textContent = String(code.textContent || "").trim();
      pre.dataset.mermaidPrepared = "true";
      pre.replaceWith(diagram);
    });
  root.querySelectorAll(".mermaid").forEach((node) => {
    if (node.dataset.processed !== "true") blocks.push(node);
  });
  return blocks;
}

function renderMermaidBlocks(root) {
  const blocks = prepareMermaidBlocks(root);
  if (!blocks.length || !initializeMermaidRenderer()) return;
  const mermaid = window.mermaid;
  const renderSeq = ++mermaidRenderSeq;
  const markError = (error) => {
    if (renderSeq !== mermaidRenderSeq && root === el.memoPreview) return;
    blocks.forEach((block) => {
      if (!block.isConnected || block.dataset.processed === "true") return;
      block.classList.add("mermaid-error");
      block.textContent = `Mermaid render error: ${error?.message || error}`;
    });
  };
  try {
    if (typeof mermaid.run === "function") {
      Promise.resolve(mermaid.run({ nodes: blocks })).catch(markError);
    } else if (typeof mermaid.init === "function") {
      mermaid.init(undefined, blocks);
    }
  } catch (error) {
    markError(error);
  }
}

function applyMarkdownPreviewPresentation(root) {
  if (!root) return;
  applyAttachmentPreviewLinks(root);
  linkifyLocalPathsInPreview(root);
  annotateUsageRefLinks(root);
  root.querySelectorAll("a").forEach((anchor) => {
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  });
  if (
    window.CodexMemoMarkdownTheme &&
    typeof window.CodexMemoMarkdownTheme.apply === "function"
  ) {
    window.CodexMemoMarkdownTheme.apply(root);
  }
  applyMarkdownTableAlignments(root);
  renderMermaidBlocks(root);
}

function createRenderedMarkdownRoot(source) {
  const root = document.createElement("article");
  root.className = "markdown-preview";
  root.style.position = "fixed";
  root.style.left = "-99999px";
  root.style.top = "0";
  root.style.width = "min(720px, 96vw)";
  root.style.visibility = "hidden";
  root.style.pointerEvents = "none";
  root.innerHTML = markdownToHtml(source || "");
  document.body.appendChild(root);
  applyMarkdownPreviewPresentation(root);
  return root;
}

function markdownToPlainText(source) {
  const root = createRenderedMarkdownRoot(source);
  const text = String(root.innerText || root.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  root.remove();
  return text;
}

function markdownToStyledTextSegments(source) {
  const root = createRenderedMarkdownRoot(source);
  const segments = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = String(node.nodeValue || "");
    if (value.length > 0) {
      const owner = node.parentElement || root;
      const computed = window.getComputedStyle(owner);
      const style = {
        color: computed.color,
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontStyle: computed.fontStyle,
        fontWeight: computed.fontWeight,
        textDecoration:
          computed.textDecorationLine || computed.textDecoration || "none",
      };
      const prev = segments[segments.length - 1];
      if (prev && JSON.stringify(prev.style) === JSON.stringify(style)) {
        prev.text += value;
      } else {
        segments.push({ text: value, style });
      }
    }
    node = walker.nextNode();
  }
  root.remove();
  return segments;
}

function renderMarkdownPreview() {
  const source = el.memoBodyInput.value || "";
  el.memoPreview.innerHTML = markdownToHtml(source);
  applyMarkdownPreviewPresentation(el.memoPreview);
}

function renderEditorDocId(item) {
  const id = String(item?.id || "").trim();
  if (!el.docIdRow || !el.docIdText || !el.copyDocIdBtn) return;
  el.docIdRow.classList.toggle("hidden", !id);
  el.docIdRow.classList.toggle("flex", Boolean(id));
  el.docIdText.textContent = id;
  el.copyDocIdBtn.dataset.docId = id;
  el.copyDocIdBtn.disabled = !id;
  el.copyDocIdBtn.title = id ? `Copy document id: ${id}` : "No document id";
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
      "</svg>",
    ].join("");
    el.bodyModeToggle.setAttribute("title", "Preview mode");
    el.bodyModeToggle.setAttribute("aria-label", "Switch to text mode");
  } else {
    el.bodyModeToggle.innerHTML = [
      '<svg viewBox="0 0 24 24" aria-hidden="true" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8">',
      '<path d="M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4Z"></path>',
      '<path d="M13.5 6.5l4 4"></path>',
      "</svg>",
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
    "text-[#f3fff3]",
  );
  if (next === "preview") {
    el.bodyModeToggle.classList.add(
      "border-[#5f8a5f]",
      "bg-[#5f8a5f]",
      "text-[#f3fff3]",
    );
  } else {
    el.bodyModeToggle.classList.add(
      "border-[#c9ced7]",
      "bg-[#fefdfb]",
      "text-[#4b5568]",
    );
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
    const ta = new Date(
      a.updatedAtISO || a.datetimeISO || a.createdAtISO || 0,
    ).getTime();
    const tb = new Date(
      b.updatedAtISO || b.datetimeISO || b.createdAtISO || 0,
    ).getTime();
    return tb - ta;
  });
}

function listItemsForView() {
  let items = state.items.filter(
    (item) => !isQuickMemoItem(item) && !isHiddenSystemMemo(item),
  );
  const storageFilterKind = currentStorageFilterKind();
  if (storageFilterKind) {
    items = items.filter(
      (item) => normalizeStorageKind(item.storageKind) === storageFilterKind,
    );
  }
  if (!state.showOnlyDeletable) {
    return items;
  }
  return items.filter((item) => Boolean(item.deletable));
}

function getVisibleItemsSorted() {
  return sortMemosForList(listItemsForView());
}

async function openUsageOverview() {
  if (!confirmDiscardEditorChanges()) return;
  await loadPersistedUsageOverview();
  fillEditor(buildUsageOverviewPanelItem(), { fromCache: false });
}

function refreshUsageStats(options = {}) {
  if (state.usageTileCollapsed) {
    return Promise.resolve(false);
  }
  const forceReload = Boolean(options.forceReload);
  const reason = String(options.reason || "").trim();
  if (usageRefreshInFlight) {
    return usageRefreshInFlight;
  }
  state.usageRefreshPending = true;
  state.usageRefreshReason = reason;
  renderList();
  usageRefreshInFlight = Promise.all([
    loadUsageSummary({ forceReload }),
    loadCodexUsageSummary({ forceReload }),
    loadStorageUsageSummary({ forceReload }),
    loadOpenAICostsSummary({ forceReload }),
  ])
    .then(async () => {
      await refreshUsageOverviewSummaryIfNeeded({ forceReload });
      await saveUsageOverviewSnapshot();
    })
    .finally(() => {
      usageRefreshInFlight = null;
      state.usageRefreshPending = false;
      state.usageRefreshReason = "";
      if (state.selectedId === USAGE_OVERVIEW_PANEL_ID) {
        fillEditor(buildUsageOverviewPanelItem({ forceRebuild: true }), {
          fromCache: false,
        });
        return;
      }
      if (state.selectedId === USAGE_PANEL_ID) {
        fillEditor(buildUsagePanelItem({ forceRebuild: true }), {
          fromCache: false,
        });
        return;
      }
      if (state.selectedId === CODEX_USAGE_PANEL_ID) {
        fillEditor(buildCodexUsagePanelItem({ forceRebuild: true }), {
          fromCache: false,
        });
        return;
      }
      renderList();
    });

  return usageRefreshInFlight;
}

function syncDeleteButtonLabel() {
  if (isQuickMemoSelected()) {
    el.deleteBtn.textContent = "Clear";
    return;
  }
  el.deleteBtn.textContent = state.showOnlyDeletable ? "ALL" : "Delete";
}

function syncQuickMemoEditorState() {
  const active = isQuickMemoSelected();
  el.threadTitleInput.classList.toggle("quick-memo-thread", active);
  el.saveBtn.title = active
    ? "Save Quick Memo (Shift: save as new memo)"
    : "Save";
}

async function loadPersistedUsageOverview() {
  try {
    const data = await request(
      `/api/memos/${encodeURIComponent(USAGE_OVERVIEW_DOC_ID)}`,
    );
    state.persistedUsageOverview = data.item || null;
    const parsed = parseUsageOverviewMemoBody(
      state.persistedUsageOverview?.memoBody || "",
    );
    restoreUsageOverviewSnapshot(parsed.snapshot);
  } catch (error) {
    if (String(error.message || "").includes("HTTP 404")) {
      state.persistedUsageOverview = null;
      return null;
    }
    console.warn("[codex-memo] persisted usage overview load failed:", error);
    state.persistedUsageOverview = null;
    return null;
  }
  return state.persistedUsageOverview;
}

async function saveUsageOverviewSnapshot() {
  const item = await upsertFixedMemo(USAGE_OVERVIEW_DOC_ID, {
    projectName: "system",
    memoType: "keep",
    threadTitle: "Usage overview",
    memoBody: serializeUsageOverviewMemoBody(buildUsageOverviewBody()),
    deletable: false,
    pinned: false,
    storageKind: currentDefaultStorageKind(),
    attachments: [],
  });
  state.persistedUsageOverview = item;
  state.items = [
    ...state.items.filter((memo) => memo.id !== USAGE_OVERVIEW_DOC_ID),
    item,
  ];
  return item;
}

async function ensureQuickMemoExists() {
  const existing = getQuickMemoItem();
  if (existing) return existing;
  if (state.quickMemoEnsuring) return null;
  state.quickMemoEnsuring = true;
  try {
    const legacy = bestLegacyQuickMemoItem(state.items);
    const payload =
      legacy && quickMemoHasContent(legacy)
        ? {
            ...buildQuickMemoSeed(
              normalizeStorageKind(
                legacy.storageKind,
                currentDefaultStorageKind(),
              ),
            ),
            memoBody: String(legacy.memoBody || ""),
            attachments: Array.isArray(legacy.attachments)
              ? legacy.attachments
              : [],
            storageKind: normalizeStorageKind(
              legacy.storageKind,
              currentDefaultStorageKind(),
            ),
          }
        : buildQuickMemoSeed(currentDefaultStorageKind());
    const item = normalizeQuickMemoItem(
      await upsertFixedMemo(QUICK_MEMO_DOC_ID, payload),
    );
    state.items = [
      ...state.items.filter((memo) => !isQuickMemoItem(memo)),
      item,
    ];
    state.quickMemoId = item.id;
    renderList();
    return item;
  } catch (error) {
    setStatus(`Quick Memo create error: ${error.message}`, true);
    return null;
  } finally {
    state.quickMemoEnsuring = false;
  }
}

async function repairQuickMemoIfNeeded() {
  const fixed =
    state.items.find((item) => item.id === QUICK_MEMO_DOC_ID) || null;
  const legacy = bestLegacyQuickMemoItem(state.items);
  if (!legacy || !quickMemoHasContent(legacy)) return false;
  if (fixed && quickMemoHasContent(fixed)) return false;

  const data = await request(
    `/api/memos/${encodeURIComponent(QUICK_MEMO_DOC_ID)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...buildQuickMemoSeed(
          normalizeStorageKind(legacy.storageKind, currentDefaultStorageKind()),
        ),
        memoBody: String(legacy.memoBody || ""),
        attachments: Array.isArray(legacy.attachments)
          ? legacy.attachments
          : [],
        storageKind: normalizeStorageKind(
          legacy.storageKind,
          currentDefaultStorageKind(),
        ),
        createIfMissing: true,
      }),
    },
  );
  const item = normalizeQuickMemoItem(data.item);
  state.items = [
    ...state.items.filter((memo) => memo.id !== QUICK_MEMO_DOC_ID),
    item,
  ];
  state.quickMemoId = item.id;
  return true;
}

async function openQuickMemo() {
  if (!confirmDiscardEditorChanges()) return;
  const quickMemo = await ensureQuickMemoExists();
  if (!quickMemo?.id) return;
  const data = await request(`/api/memos/${encodeURIComponent(quickMemo.id)}`);
  fillEditor(normalizeQuickMemoItem(data.item), {
    fromCache: state.lastResponseCacheHit,
    editorStorageKind: data.item?.storageKind,
  });
}

async function saveQuickMemo({ saveAsNew = false } = {}) {
  const validationError = currentPayloadValidationError();
  if (validationError) {
    setStatus(validationError, true);
    return;
  }

  try {
    if (saveAsNew) {
      const data = await request("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: QUICK_MEMO_PROJECT_NAME,
          memoType: "memo",
          threadTitle: firstMeaningfulBodyLine(el.memoBodyInput.value),
          memoBody: String(el.memoBodyInput.value || "").trim(),
          storageKind: currentQuickMemoStorageKind(),
          attachments: currentEditorAttachments(),
        }),
      });
      fillEditor(data.item, { fromCache: false });
      setStatus(`Created: ${data.item.id}`);
      await loadMemos();
      return;
    }

    const quickMemo = await ensureQuickMemoExists();
    if (!quickMemo?.id) return;
    const data = await request(
      `/api/memos/${encodeURIComponent(quickMemo.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...quickMemoSavePayload(),
          createIfMissing: true,
        }),
      },
    );
    fillEditor(normalizeQuickMemoItem(data.item), {
      fromCache: false,
      editorStorageKind: data.item?.storageKind,
    });
    setStatus(`Updated: ${data.item.id}`);
    await loadMemos();
  } catch (error) {
    setStatus(`Save error: ${error.message}`, true);
  }
}

async function clearQuickMemo() {
  const quickMemo = await ensureQuickMemoExists();
  if (!quickMemo?.id) return;
  const ok = window.confirm(
    "Clear Quick Memo? body and attachments will be removed.",
  );
  if (!ok) {
    setStatus("Clear cancelled", true);
    return;
  }
  try {
    const data = await request(
      `/api/memos/${encodeURIComponent(quickMemo.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          quickMemoSavePayload({
            memoBody: "",
            attachments: [],
            createIfMissing: true,
          }),
        ),
      },
    );
    fillEditor(normalizeQuickMemoItem(data.item), {
      fromCache: false,
      editorStorageKind: data.item?.storageKind,
    });
    setStatus("Quick Memo cleared", false, "force");
    await loadMemos();
  } catch (error) {
    setStatus(`Clear error: ${error.message}`, true);
  }
}

function memoTypeBadgeTone(memoType) {
  switch (memoType) {
    case "memo":
      return {
        borderColor: "rgba(142, 155, 176, 0.86)",
        backgroundColor: "rgba(124, 138, 161, 0.94)",
        color: "#fff8ee",
      };
    case "handover memo":
      return {
        borderColor: "rgba(204, 143, 86, 0.86)",
        backgroundColor: "rgba(185, 123, 67, 0.94)",
        color: "#fff8ee",
      };
    case "keep":
      return {
        borderColor: "rgba(108, 174, 111, 0.88)",
        backgroundColor: "rgba(87, 168, 93, 0.94)",
        color: "#fff8ee",
      };
    case "propomemo":
      return {
        borderColor: "rgba(185, 146, 104, 0.86)",
        backgroundColor: "rgba(164, 123, 80, 0.94)",
        color: "#fff8ee",
      };
    default:
      return {
        borderColor: "rgba(134, 148, 178, 0.86)",
        backgroundColor: "rgba(116, 131, 163, 0.94)",
        color: "#fff8ee",
      };
  }
}

function displayMemoTypeLabel(memoType) {
  if (memoType === "handover memo") return "handover";
  if (memoType === "propomemo") return "propo";
  return memoType || "memo";
}

async function loadUsageSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams({
    hours: String(USAGE_PANEL_HOURS),
  });
  if (forceReload) {
    params.set("nocache", "1");
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/firestore?${params.toString()}`,
    controller ? { signal: controller.signal } : undefined,
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
    state.usageError = error.message || "Failed to load usage";
  }
}

async function loadCodexUsageSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams();
  if (forceReload) params.set("nocache", "1");

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/codex?${params.toString()}`,
    controller ? { signal: controller.signal } : undefined,
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
    state.codexUsageError = error.message || "Failed to load codex usage";
  }
}

async function loadStorageUsageSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams();
  if (forceReload) params.set("nocache", "1");

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/storage?${params.toString()}`,
    controller ? { signal: controller.signal } : undefined,
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
    state.storageUsageSummary = body;
    state.storageUsageError = "";
    state.storageUsageFetchedAtISO = new Date().toISOString();
  } catch (error) {
    state.storageUsageError = error.message || "Failed to load storage usage";
  }
}

async function loadOpenAICostsSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams();
  if (forceReload) params.set("nocache", "1");

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/openai-costs?${params.toString()}`,
    controller ? { signal: controller.signal } : undefined,
  );
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Timed out (${OPENAI_COSTS_FETCH_TIMEOUT_MS}ms)`));
    }, OPENAI_COSTS_FETCH_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    state.openaiCostsSummary = body;
    state.openaiCostsError = "";
    state.openaiCostsFetchedAtISO = new Date().toISOString();
  } catch (error) {
    state.openaiCostsError = error.message || "Failed to load OpenAI costs";
  }
}

function renderList() {
  el.memoList.innerHTML = "";
  if (el.usagePanelSlot) {
    el.usagePanelSlot.innerHTML = "";
  }
  const quickMemoItem = getQuickMemoItem();
  const items = sortMemosForList(listItemsForView());

  const usageLi = document.createElement("li");
  usageLi.className = [
    "group",
    "relative",
    "cursor-pointer",
    "px-0.5",
    "py-0.5",
    "transition-opacity",
    "hover:opacity-95",
  ].join(" ");

  const fsSnapshot = getFirestoreTodaySnapshot();
  const fsPeak = Math.max(
    fsSnapshot.ratePercent.read,
    fsSnapshot.ratePercent.write,
    fsSnapshot.ratePercent.delete,
  );
  const storageSnapshot = getStorageSnapshot();
  const openaiSnapshot = getOpenAISnapshot();
  const codexSecondary = state.codexUsageSummary?.secondaryWindow || null;
  const usageActive = isUsageOverviewPanelSelected();

  const row = document.createElement("div");
  row.className = "grid grid-cols-2 gap-1.5";

  function makeMiniBars(values, colors, backgrounds, titles = [], labels = []) {
    const wrap = document.createElement("div");
    wrap.className = "mt-0.5 flex h-9 w-full items-end justify-center gap-1";
    values.forEach((value, index) => {
      const col = document.createElement("div");
      col.className = "flex w-4 flex-col items-center gap-0.5";
      const track = document.createElement("span");
      track.className = `relative block h-7 w-[7px] overflow-hidden rounded-full ${backgrounds[index]}`;
      track.title = titles[index] || "";
      const fill = document.createElement("span");
      fill.className = `absolute bottom-0 left-0 right-0 rounded-full ${colors[index]}`;
      fill.style.height = `${Math.max(8, Math.min(100, Number(value || 0)))}%`;
      const label = document.createElement("span");
      label.className = "text-[8px] font-semibold leading-none text-[#eef4ff]";
      label.textContent = labels[index] || String(index + 1);
      track.appendChild(fill);
      col.appendChild(track);
      col.appendChild(label);
      wrap.appendChild(col);
    });
    return wrap;
  }

  function makeMiniProgressRows(rows) {
    const wrap = document.createElement("div");
    wrap.className = "mt-0.5 w-full space-y-0.5";
    rows.forEach((row) => {
      const line = document.createElement("div");
      line.className = "flex w-full items-center gap-1";
      const label = document.createElement("span");
      label.className = "w-7 text-[9px] font-semibold leading-3 text-[#eef4ff]";
      label.textContent = row.label;
      const track = document.createElement("span");
      track.className = `relative block h-[6px] flex-1 overflow-hidden rounded-full ${row.bg}`;
      track.title = row.title || "";
      const fill = document.createElement("span");
      fill.className = `absolute bottom-0 left-0 top-0 rounded-full ${row.color}`;
      fill.style.width = `${Math.max(8, Math.min(100, Number(row.value || 0)))}%`;
      track.appendChild(fill);
      line.appendChild(label);
      line.appendChild(track);
      wrap.appendChild(line);
    });
    return wrap;
  }

  function makeMiniLine(values, colorClass, bgClass) {
    const wrap = document.createElement("div");
    wrap.className = `mt-0.5 h-7 w-full overflow-hidden rounded-[6px] ${bgClass} px-1 py-0.5`;
    const points = values
      .map((value, index) => {
        const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
        const y = 100 - Math.max(6, Math.min(94, Number(value || 0)));
        return `${x},${y}`;
      })
      .join(" ");
    wrap.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="h-full w-full"><polyline fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="${points}" class="${colorClass}"></polyline></svg>`;
    return wrap;
  }

  function makeMiniSemicircleGauges(items) {
    const wrap = document.createElement("div");
    wrap.className = "mt-0.5 flex w-full items-end justify-between gap-1";
    items.forEach((item) => {
      const gaugeWrap = document.createElement("div");
      gaugeWrap.className = "flex min-w-0 flex-1 justify-center";
      gaugeWrap.title = item.title || "";

      const rawValue = Number(item.value || 0);
      const value = Math.max(0, Math.min(100, rawValue));
      const radius = 18;
      const circumference = Math.PI * radius;
      const fillLength = (value / 100) * circumference;
      const label = String(item.label || "");
      const labelColor = String(item.labelColor || "#f8fbff");

      gaugeWrap.innerHTML = `
        <svg viewBox="0 0 52 34" class="h-9 w-full overflow-visible">
          <path d="M8 28 A18 18 0 0 1 44 28" fill="none" stroke="${item.trackColor}" stroke-width="5" stroke-linecap="butt"></path>
          <path d="M8 28 A18 18 0 0 1 44 28" fill="none" stroke="${item.fillColor}" stroke-width="5" stroke-linecap="butt" stroke-dasharray="${fillLength} ${circumference}"></path>
          <text x="26" y="32.0" text-anchor="middle" dominant-baseline="ideographic" font-size="14" font-weight="500" fill="${labelColor}">${label}</text>
        </svg>
      `;
      wrap.appendChild(gaugeWrap);
    });
    return wrap;
  }

  function makeMiniOpenAICombinedGraph(
    dailyValues,
    currentUsd,
    maxUsd = 5,
    markerUsd = 3,
  ) {
    const wrap = document.createElement("div");
    wrap.className = "mt-0.5 w-full space-y-0.5";

    const line = document.createElement("div");
    line.className =
      "h-5 w-full overflow-hidden rounded-[6px] bg-[#4b5563] px-1 py-0.5";
    const points = dailyValues
      .map((value, index) => {
        const x =
          dailyValues.length <= 1
            ? 0
            : (index / (dailyValues.length - 1)) * 100;
        const y = 100 - Math.max(6, Math.min(94, Number(value || 0)));
        return `${x},${y}`;
      })
      .join(" ");
    line.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="h-full w-full"><polyline fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="${points}" class="text-[#ebc8d4]"></polyline></svg>`;

    const track = document.createElement("div");
    track.className =
      "relative h-[6px] w-full overflow-hidden rounded-full bg-[#eceef1]";
    track.title = `current ${formatUsd(currentUsd, 2)} / max ${formatUsd(maxUsd, 0)}`;

    const fill = document.createElement("span");
    fill.className = "absolute bottom-0 left-0 top-0 rounded-full bg-[#cf7896]";
    fill.style.width = `${Math.max(0, Math.min(100, (Number(currentUsd || 0) / Math.max(0.001, maxUsd)) * 100))}%`;
    track.appendChild(fill);

    if (Number.isFinite(markerUsd) && markerUsd > 0) {
      const marker = document.createElement("span");
      marker.className =
        "absolute top-1/2 z-10 h-[12px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b828a]";
      marker.style.left = `${Math.max(0, Math.min(100, (Number(markerUsd || 0) / Math.max(0.001, maxUsd)) * 100))}%`;
      marker.title = `marker ${formatUsd(markerUsd, 0)}`;
      track.appendChild(marker);
    }

    wrap.appendChild(line);
    wrap.appendChild(track);
    return wrap;
  }

  function makeUsageCard({
    title,
    badgeText,
    badgePressure,
    summaryText,
    summaryHtml,
    graphEl,
    dblclickUrl,
    titleText,
  }) {
    const card = document.createElement("div");
    card.className =
      "flex h-[74px] flex-col rounded-md border border-[#4b5563] bg-[#4b5563] px-2 py-1";
    card.title = titleText || "";
    if (dblclickUrl) {
      card.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.open(dblclickUrl, "_blank", "noopener,noreferrer");
      });
    }
    const top = document.createElement("div");
    top.className = "flex items-center justify-between gap-1";
    const head = document.createElement("strong");
    head.className = "block text-[12px] leading-4 text-[#f9fafb]";
    head.textContent = title;
    const badge = document.createElement("span");
    badge.className =
      "usage-badge inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold leading-none border bg-[#ffffff] text-[#374151]";
    applyPressureBadgeBorder(badge, badgePressure);
    badge.textContent = badgeText;
    const main = document.createElement("div");
    main.className = "mt-auto truncate text-[10px] leading-3 text-[#e5e7eb]";
    if (summaryHtml) {
      main.innerHTML = summaryHtml;
    } else {
      main.textContent = summaryText;
    }
    top.appendChild(head);
    top.appendChild(badge);
    card.appendChild(top);
    if (graphEl) {
      const graphSlot = document.createElement("div");
      graphSlot.className =
        "flex h-8 w-full min-w-0 items-center justify-center";
      graphSlot.appendChild(graphEl);
      card.appendChild(graphSlot);
    }
    card.appendChild(main);
    return card;
  }

  row.appendChild(
    makeUsageCard({
      title: "Firestore",
      badgeText: state.usageSummary ? `${fsPeak.toFixed(1)}%` : "-",
      badgePressure: fsPeak,
      graphEl: makeMiniSemicircleGauges([
        {
          label: "R",
          value: fsSnapshot.relativePercent.read,
          fillColor: "#7fb6f6",
          trackColor: "#5f7ea3",
          title: `read vs peak(excl today) ${formatPercent(fsSnapshot.relativePercent.read, 1)}`,
        },
        {
          label: "W",
          value: fsSnapshot.relativePercent.write,
          fillColor: "#ffc36f",
          trackColor: "#8f7650",
          title: `write vs peak(excl today) ${formatPercent(fsSnapshot.relativePercent.write, 1)}`,
        },
        {
          label: "D",
          value: fsSnapshot.relativePercent.delete,
          fillColor: "#ff9bb9",
          trackColor: "#94677b",
          title: `delete vs peak(excl today) ${formatPercent(fsSnapshot.relativePercent.delete, 1)}`,
        },
      ]),
      summaryHtml: state.usageSummary
        ? `r${formatPercent(fsSnapshot.ratePercent.read, 1)} - w${formatPercent(fsSnapshot.ratePercent.write, 1)} - d${formatPercent(fsSnapshot.ratePercent.delete, 1)}`
        : "",
      summaryText: state.usageSummary
        ? ""
        : state.usageError
          ? "error"
          : "loading...",
      dblclickUrl: USAGE_REF_URLS_BY_KEY.firestore,
      titleText: "Double-click to open Firestore usage",
    }),
  );

  row.appendChild(
    makeUsageCard({
      title: "Storage",
      badgeText: state.storageUsageSummary
        ? `${storageSnapshot.peakPercent.toFixed(1)}%`
        : "-",
      badgePressure: storageSnapshot.peakPercent,
      graphEl: makeMiniProgressRows([
        {
          label: "Save",
          value: Number(storageSnapshot.percentOfNoCost.storage || 0),
          color: "bg-[#b8efe8]",
          bg: "bg-[#5f8b87]",
          title: `storage ${formatPercent(storageSnapshot.percentOfNoCost.storage, 1)}`,
        },
        {
          label: "Tran",
          value: Number(storageSnapshot.percentOfNoCost.download || 0),
          color: "bg-[#9fe0ff]",
          bg: "bg-[#5a88a0]",
          title: `transfer ${formatPercent(storageSnapshot.percentOfNoCost.download, 1)}`,
        },
      ]),
      summaryHtml: state.storageUsageSummary
        ? `sv: <strong>${formatBytes(storageSnapshot.bytes)}</strong> - tr:<strong>${formatBytes(storageSnapshot.egressBytes30d)}</strong>`
        : "",
      summaryText: state.storageUsageSummary
        ? ""
        : state.storageUsageError
          ? "error"
          : "loading...",
      dblclickUrl: USAGE_REF_URLS_BY_KEY.storage,
      titleText: "Double-click to open Storage usage",
    }),
  );

  row.appendChild(
    makeUsageCard({
      title: "OpenAI",
      badgeText: state.openaiCostsSummary
        ? state.openaiCostsSummary.available
          ? formatUsd(openaiSnapshot.totalUsd30d, 2)
          : "n/a"
        : "-",
      badgePressure: Math.min(100, openaiSnapshot.totalUsd30d * 10),
      graphEl: makeMiniOpenAICombinedGraph(
        (Array.isArray(state.openaiCostsSummary?.daily)
          ? state.openaiCostsSummary.daily.slice(-10)
          : []
        )
          .map((item) => Number(item.amountUsd || 0) * 100)
          .map((value) => Math.max(10, Math.min(100, value * 2))),
        Number(openaiSnapshot.totalUsd30d || 0),
        3.5,
        3,
      ),
      summaryHtml: state.openaiCostsSummary
        ? state.openaiCostsSummary.available
          ? `<strong>${formatUsd(openaiSnapshot.totalUsd30d, 3)}</strong> = <strong>${formatJpy(getRoughMonthlyCostSnapshot().openaiJpy, 0)}</strong>  *${Math.round(getRoughMonthlyCostSnapshot().usdToJpy)}`
          : ""
        : "",
      summaryText: state.openaiCostsSummary
        ? state.openaiCostsSummary.available
          ? ""
          : "admin key not set"
        : state.openaiCostsError
          ? "error"
          : "loading...",
      dblclickUrl: USAGE_REF_URLS_BY_KEY.openai,
      titleText: "Double-click to open OpenAI usage",
    }),
  );

  row.appendChild(
    makeUsageCard({
      title: "Codex",
      badgeText: state.codexUsageSummary
        ? `${formatPercent(codexSecondary?.usedPercent, 0)}`
        : "-",
      badgePressure: 100 - Number(codexSecondary?.remainingPercent || 0),
      graphEl: makeMiniProgressRows([
        {
          label: "5h",
          value: Number(
            state.codexUsageSummary?.primaryWindow?.remainingPercent || 0,
          ),
          color: "bg-[#ffd792]",
          bg: "bg-[#826542]",
          title: `5h ${formatPercent(state.codexUsageSummary?.primaryWindow?.remainingPercent, 0)}`,
        },
        {
          label: "1w",
          value: Number(codexSecondary?.remainingPercent || 0),
          color: "bg-[#baf0a7]",
          bg: "bg-[#5c8257]",
          title: `1w ${formatPercent(codexSecondary?.remainingPercent, 0)}`,
        },
      ]),
      summaryHtml: state.codexUsageSummary
        ? `5h:<strong>${formatPercent(state.codexUsageSummary?.primaryWindow?.remainingPercent, 0)}</strong> - 1w:<strong>${formatPercent(codexSecondary?.remainingPercent, 0)}</strong>`
        : "",
      summaryText: state.codexUsageSummary
        ? ""
        : state.codexUsageError
          ? "error"
          : "loading...",
      dblclickUrl: USAGE_REF_URLS_BY_KEY.codex,
      titleText: "Double-click to open Codex usage",
    }),
  );
  const usageTop = document.createElement("div");
  usageTop.className = state.usageTileCollapsed
    ? "mb-1 flex cursor-pointer items-center justify-between rounded-md border border-[#4b5563] bg-[#4b5563] px-2 py-1"
    : usageActive
      ? "mb-1 flex cursor-pointer items-center justify-between rounded-md border border-[#d8d8d8] bg-[#e9e9e9] px-2 py-1"
      : "mb-1 flex cursor-pointer items-center justify-between px-1";
  const usageLabel = document.createElement("span");
  usageLabel.className = state.usageTileCollapsed
    ? "hidden"
    : "text-[10px] font-semibold tracking-wide text-[#7c869a]";
  usageLabel.textContent = state.usageTileCollapsed ? "" : "usage";
  const usageMeta = document.createElement("span");
  usageMeta.className = state.usageTileCollapsed
    ? "hidden"
    : "ml-2 min-w-0 flex-1 truncate text-[10px] text-[#9098a8]";
  if (!state.usageTileCollapsed) {
    const latestFetchedAtISO = getUsageStatsLatestFetchedAtISO();
    const roughCost = getRoughMonthlyCostSnapshot();
    const updatingText = state.usageRefreshPending
      ? state.usageRefreshReason === "summary"
        ? " / refreshing for AI..."
        : " / updating..."
      : "";
    usageMeta.innerHTML = `<strong class="font-semibold text-[#6f7889]">${formatUsd(roughCost.totalUsd, 2)} / ${formatJpy(roughCost.totalJpy, 0)}</strong> / ${formatDate(latestFetchedAtISO)}${updatingText}`;
    usageMeta.title = `rough total cost ${formatUsd(roughCost.totalUsd, 2)} / ${formatJpy(roughCost.totalJpy, 0)} | latest fetch ${formatDate(latestFetchedAtISO)}${state.usageRefreshPending ? " | updating" : ""}`;
  }
  const collapseIcon = document.createElement("span");
  collapseIcon.className = state.usageTileCollapsed
    ? "inline-flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-[#e5e7eb]"
    : "inline-flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-[#7c869a]";
  collapseIcon.textContent = state.usageTileCollapsed ? ">" : "v";
  usageTop.setAttribute(
    "aria-label",
    state.usageTileCollapsed ? "Expand usage tile" : "Collapse usage tile",
  );
  usageTop.title = state.usageTileCollapsed
    ? "Expand usage tile"
    : "Collapse usage tile";
  usageTop.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    state.usageTileCollapsed = !state.usageTileCollapsed;
    renderList();
  });
  usageTop.appendChild(usageLabel);
  usageTop.appendChild(usageMeta);
  if (state.usageTileCollapsed) {
    const collapsedSummary = document.createElement("div");
    collapsedSummary.className =
      "mx-2 grid min-w-0 flex-1 grid-cols-4 items-center justify-items-center gap-1 text-[11px] leading-4 text-[#e5e7eb]";

    const collapsedItems = [
      {
        label: "FS",
        text: state.usageSummary ? `${fsPeak.toFixed(1)}%` : "-",
        pressure: fsPeak,
      },
      {
        label: "ST",
        text: state.storageUsageSummary
          ? `${storageSnapshot.peakPercent.toFixed(1)}%`
          : "-",
        pressure: storageSnapshot.peakPercent,
      },
      {
        label: "OA",
        text: state.openaiCostsSummary
          ? state.openaiCostsSummary.available
            ? formatUsd(openaiSnapshot.totalUsd30d, 1)
            : "n/a"
          : "-",
        pressure: Math.min(100, openaiSnapshot.totalUsd30d * 10),
      },
      {
        label: "CX",
        text: state.codexUsageSummary
          ? `${formatPercent(codexSecondary?.usedPercent, 0)}`
          : "-",
        pressure: 100 - Number(codexSecondary?.remainingPercent || 0),
      },
    ];
    for (const item of collapsedItems) {
      const wrap = document.createElement("span");
      wrap.className = "inline-flex min-w-0 items-center justify-center gap-1";
      const label = document.createElement("span");
      label.className = "text-[11px] font-bold tracking-wide text-[#e5e7eb]";
      label.textContent = item.label;
      const badge = document.createElement("span");
      badge.className =
        "usage-badge inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold leading-none border bg-[#ffffff] text-[#374151]";
      applyPressureBadgeBorder(badge, item.pressure);
      badge.textContent = item.text;
      wrap.appendChild(label);
      wrap.appendChild(badge);
      collapsedSummary.appendChild(wrap);
    }
    usageTop.appendChild(collapsedSummary);
  }
  usageTop.appendChild(collapseIcon);
  usageLi.appendChild(usageTop);
  if (!state.usageTileCollapsed) {
    usageLi.appendChild(row);
  }
  usageLi.title = `Firestore: ${formatDate(state.usageFetchedAtISO || state.usageSummary?.endTime)} | Storage: ${formatDate(state.storageUsageFetchedAtISO || state.storageUsageSummary?.fetchedAtISO)} | OpenAI: ${formatDate(state.openaiCostsFetchedAtISO || state.openaiCostsSummary?.fetchedAtISO)} | Codex: ${formatDate(state.codexUsageFetchedAtISO || state.codexUsageSummary?.fetchedAtISO)}`;
  usageLi.addEventListener("click", () => {
    openUsageOverview().catch((error) => {
      setStatus(`Usage overview open error: ${error.message || error}`, true);
    });
  });
  if (el.usagePanelSlot) {
    el.usagePanelSlot.appendChild(usageLi);
  } else {
    el.memoList.appendChild(usageLi);
  }

  if (quickMemoItem) {
    const quickLi = document.createElement("li");
    quickLi.className = [
      "group",
      "relative",
      "cursor-pointer",
      "mt-[3px]",
      "px-0.5",
      "py-0.5",
      "transition-opacity",
      "hover:opacity-95",
    ].join(" ");

    const quickActive = isQuickMemoSelected();
    const card = document.createElement("div");
    card.className = [
      "relative",
      "rounded-lg",
      "px-2.5",
      "py-2",
      quickActive ? "bg-[#e9e9e9]" : "bg-[#f6f7f5]",
    ]
      .join(" ")
      .trim();

    const accent = document.createElement("span");
    accent.className =
      "absolute inset-y-[6px] left-0 w-[4px] rounded-none bg-[#f0a020]";
    card.appendChild(accent);

    const top = document.createElement("div");
    top.className = "flex items-center gap-1";
    const title = document.createElement("strong");
    title.className = "block text-[13px] leading-4 text-[#4f5f7e]";
    title.textContent = QUICK_MEMO_TITLE;
    top.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "mt-0.5 flex min-w-0 items-center gap-1";
    const typeBadge = document.createElement("span");
    typeBadge.className =
      "list-badge inline-flex h-3.5 shrink-0 items-center rounded-md border border-[#db9a37] bg-[#e9ae57] px-1 text-[9px] font-semibold leading-none text-[#fff8ee]";
    typeBadge.textContent = "sticky";
    const dateText = document.createElement("small");
    dateText.className =
      "shrink-0 whitespace-nowrap text-[9px] leading-3.5 text-[#7f8aa3]";
    dateText.textContent = formatDate(
      quickMemoItem.updatedAtISO || quickMemoItem.createdAtISO,
    );
    meta.appendChild(typeBadge);
    meta.appendChild(dateText);

    if (hasBodyLink(quickMemoItem.memoBody || "")) {
      const linkBadge = document.createElement("span");
      linkBadge.className =
        "list-badge inline-flex h-3.5 shrink-0 items-center rounded border border-[#d6dce8] px-1 text-[8px] font-medium leading-none text-[#7a859e]";
      linkBadge.textContent = "link";
      linkBadge.title = "Body contains link/path";
      meta.appendChild(linkBadge);
    }

    if (hasBodyImage(quickMemoItem)) {
      const imgBadge = document.createElement("span");
      imgBadge.className =
        "list-badge inline-flex h-3.5 shrink-0 items-center rounded border border-[#dcd8ef] px-1 text-[8px] font-medium leading-none text-[#7d78a0]";
      imgBadge.textContent = "img";
      imgBadge.title = "Body contains image";
      meta.appendChild(imgBadge);
    }

    card.appendChild(top);
    card.appendChild(meta);
    quickLi.appendChild(card);
    quickLi.addEventListener("click", () => {
      openQuickMemo().catch((error) => {
        setStatus(`Quick Memo open error: ${error.message || error}`, true);
      });
    });
    if (el.usagePanelSlot) {
      el.usagePanelSlot.appendChild(quickLi);
    } else {
      el.memoList.appendChild(quickLi);
    }
  }

  for (const item of items) {
    const li = document.createElement("li");
    const isActive = item.id === state.selectedId;
    const isPinned = Boolean(item.pinned);
    const isDeletable = Boolean(item.deletable);
    const pinBlocked = !isPinned && isDeletable;
    const delBlocked = !isDeletable && isPinned;
    const storageKind = normalizeStorageKind(item.storageKind, "firebase");
    const accentClass = isPinned
      ? storageKind === "icloud"
        ? "bg-[#5f7fb8]"
        : "bg-[#d96f98]"
      : storageKind === "icloud"
        ? "bg-[#7690b5]"
        : "bg-[#c07f92]";
    li.className = [
      "group",
      "relative",
      "cursor-pointer",
      "rounded-lg",
      "px-2.5",
      "py-2",
      "transition-colors",
      "hover:bg-[#e3e3e2]",
      isActive ? "bg-[#e9e9e9]" : isPinned ? "bg-[#f6f7f5]" : "bg-[#f6f7f5]",
    ].join(" ");

    const accent = document.createElement("span");
    accent.className = `absolute ${isPinned ? "inset-y-[6px] w-[4px]" : "inset-y-[6px] w-[2px]"} left-0 rounded-none ${accentClass}`;
    li.appendChild(accent);

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
      "list-badge",
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
    ].join(" ");
    Object.assign(typeBadge.style, memoTypeBadgeTone(item.memoType));
    typeBadge.textContent = displayMemoTypeLabel(item.memoType);
    const metaText = document.createElement("small");
    metaText.className =
      "block min-w-0 truncate whitespace-nowrap text-[9px] leading-3.5 text-[#78829a]";
    metaText.textContent = `${item.projectName}`;
    const dateText = document.createElement("small");
    dateText.className =
      "shrink-0 whitespace-nowrap text-[9px] leading-3.5 text-[#7f8aa3]";
    dateText.textContent = formatDate(
      item.updatedAtISO || item.datetimeISO || item.createdAtISO,
    );
    meta.appendChild(typeBadge);
    meta.appendChild(metaText);
    meta.appendChild(dateText);

    if (hasBodyLink(item.memoBody || "")) {
      const linkBadge = document.createElement("span");
      linkBadge.className =
        "inline-flex h-3.5 shrink-0 items-center rounded border border-[#d6dce8] px-1 text-[8px] font-medium leading-none text-[#7a859e]";
      linkBadge.textContent = "link";
      linkBadge.title = "Body contains link/path";
      meta.appendChild(linkBadge);
    }

    if (hasBodyImage(item)) {
      const imgBadge = document.createElement("span");
      imgBadge.className =
        "inline-flex h-3.5 shrink-0 items-center rounded border border-[#dcd8ef] px-1 text-[8px] font-medium leading-none text-[#7d78a0]";
      imgBadge.textContent = "img";
      imgBadge.title = "Body contains image";
      meta.appendChild(imgBadge);
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
        ? "text-[#6e84ad]"
        : "text-[#94a3b8] hover:text-[#6e84ad] focus-visible:text-[#6e84ad]",
      isPinned
        ? "opacity-100 pointer-events-auto"
        : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
      "transition-opacity",
      pinBlocked ? "opacity-40 cursor-not-allowed" : "",
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
      "</svg>",
    ].join("");
    pinBtn.title = pinBlocked
      ? "Pin is disabled while DEL is on"
      : isPinned
        ? "Unpin"
        : "Pin";
    pinBtn.setAttribute(
      "aria-label",
      pinBlocked ? "Pin disabled" : isPinned ? "Unpin" : "Pin",
    );
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
      delBlocked ? "opacity-40 cursor-not-allowed" : "",
    ].join(" ");
    const delIconClass = "h-full w-full stroke-current transition-colors";
    delBtn.innerHTML = [
      `<svg viewBox="0 0 24 24" aria-hidden="true" class="${delIconClass}" stroke-width="1.7">`,
      '<path d="m6 9 6-4 6 4v8l-6 4-6-4Z" fill="none" stroke-linejoin="round"></path>',
      '<circle cx="12" cy="13" r="1.8" fill="currentColor" stroke="none"></circle>',
      "</svg>",
    ].join("");
    delBtn.title = delBlocked
      ? "DEL is disabled while PIN is on"
      : isDeletable
        ? "Unset deletable"
        : "Set deletable";
    delBtn.setAttribute(
      "aria-label",
      delBlocked
        ? "DEL disabled"
        : isDeletable
          ? "Unset deletable"
          : "Set deletable",
    );
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
  const normalizedItem = isQuickMemoItem(item)
    ? normalizeQuickMemoItem(item)
    : item;
  const isOverviewPanel =
    normalizedItem && normalizedItem.id === USAGE_OVERVIEW_PANEL_ID;
  const isUsagePanel = normalizedItem && normalizedItem.id === USAGE_PANEL_ID;
  const isCodexPanel =
    normalizedItem && normalizedItem.id === CODEX_USAGE_PANEL_ID;
  const isQuickMemo = isQuickMemoItem(normalizedItem);
  const isMarkdownCssMemo = isMarkdownCssMemoItem(normalizedItem);
  const isReadOnlyPanel = Boolean(
    isOverviewPanel || isUsagePanel || isCodexPanel,
  );
  state.selectedId =
    normalizedItem && normalizedItem.id ? normalizedItem.id : null;
  state.selectedCacheHit = Boolean(options.fromCache);
  if (isReadOnlyPanel) {
    setEditorStorageKind(currentDefaultStorageKind());
  } else if (normalizedItem?.storageKind) {
    setEditorStorageKind(normalizedItem.storageKind);
  } else if (!state.selectedId) {
    setEditorStorageKind(
      options.editorStorageKind || currentDefaultStorageKind(),
    );
  }
  renderStorageControls();
  el.projectNameInput.value = normalizedItem?.projectName || "";
  el.memoTypeInput.value = normalizedItem?.memoType || "memo";
  el.threadTitleInput.value = normalizedItem?.threadTitle || "";
  el.memoBodyInput.value = normalizedItem?.memoBody || "";
  if (isMarkdownCssMemo) {
    applyMarkdownCustomCssFromMemo(normalizedItem);
  } else {
    applyMarkdownCustomCss(
      state.markdownCssMemoBody || DEFAULT_MARKDOWN_CUSTOM_CSS,
    );
  }
  state.editorAttachments = normalizeEditorAttachments(
    normalizedItem?.attachments,
  );
  state.attachmentListExpanded = false;
  renderAttachmentList();
  renderStorageInfo(state.selectedId ? normalizedItem : null);
  renderEditorDocId(normalizedItem);
  renderEditorDividerAccent(isReadOnlyPanel ? "" : currentEditingStorageKind());
  renderSummaryButtonTooltip();
  if (el.dateText) {
    el.dateText.textContent = isUsagePanel
      ? formatDate(state.usageFetchedAtISO || state.usageSummary?.endTime)
      : isOverviewPanel
        ? formatDate(
            state.codexUsageFetchedAtISO ||
              state.usageFetchedAtISO ||
              normalizedItem?.updatedAtISO,
          )
        : isCodexPanel
          ? formatDate(
              state.codexUsageFetchedAtISO ||
                state.codexUsageSummary?.fetchedAtISO,
            )
          : renderDateWithCacheIndicator(
              normalizedItem?.updatedAtISO ||
                normalizedItem?.createdAtISO ||
                normalizedItem?.datetimeISO,
            );
  }
  el.projectNameInput.readOnly =
    isReadOnlyPanel || isQuickMemo || isMarkdownCssMemo;
  el.threadTitleInput.readOnly =
    isReadOnlyPanel || isQuickMemo || isMarkdownCssMemo;
  el.memoBodyInput.readOnly = isReadOnlyPanel;
  el.memoTypeInput.disabled =
    isReadOnlyPanel || isQuickMemo || isMarkdownCssMemo;
  el.addImageBtn.disabled = isReadOnlyPanel || isQuickMemo || isMarkdownCssMemo;
  state.editorBaseline = isReadOnlyPanel ? null : currentEditorSnapshot();
  updateSaveButtonState();
  el.deleteBtn.disabled = isReadOnlyPanel;
  // Export actions are allowed for usage panels as read-only snapshots.
  el.downloadFormatSelect.disabled = false;
  el.downloadBtn.disabled = false;
  el.shareBtn.disabled = false;
  syncDeleteButtonLabel();
  syncQuickMemoEditorState();
  el.deleteBtn.title = isReadOnlyPanel
    ? "Delete is disabled in usage panel"
    : isQuickMemo
      ? "Clear Quick Memo"
      : state.showOnlyDeletable
        ? "ALL: delete all deletable docs (Shift: filter off)"
        : "ALL: delete all deletable docs (Shift: filter on)";
  setBodyMode(options.bodyMode || "preview");
  updateBodyMode();
  renderList();
  setStatus(
    isReadOnlyPanel
      ? "Usage detail view"
      : isQuickMemo
        ? "Quick Memo"
        : isMarkdownCssMemo
          ? "Markdown CSS memo"
          : "",
  );
}

function applyUpdatedMemo(updated) {
  if (isMarkdownCssMemoItem(updated)) {
    applyMarkdownCustomCssFromMemo(updated);
  }
  upsertMemoInState(updated);
  if (state.selectedId === updated.id) {
    fillEditor(updated, { fromCache: false });
  } else {
    renderList();
  }
}

async function togglePin(item) {
  const nextPinned = !Boolean(item.pinned);

  try {
    const data = await request(
      `/api/memos/${encodeURIComponent(item.id)}/pin`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned }),
      },
    );
    applyUpdatedMemo(data.item);
    setStatus(
      data.item.pinned
        ? `Pinned: ${data.item.id}`
        : `Unpinned: ${data.item.id}`,
    );
  } catch (error) {
    if (!String(error.message).includes("HTTP 404")) {
      setStatus(`Pin update error: ${error.message}`, true);
      return;
    }

    // Backward compatibility: old server without PATCH /pin route.
    try {
      const fallback = await request(
        `/api/memos/${encodeURIComponent(item.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectName: item.projectName || "",
            memoType: item.memoType || "memo",
            threadTitle: item.threadTitle || "(no title)",
            memoBody: item.memoBody || " ",
            deletable: Boolean(item.deletable),
            pinned: nextPinned,
          }),
        },
      );
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
    const data = await request(
      `/api/memos/${encodeURIComponent(item.id)}/deletable`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletable: nextDeletable }),
      },
    );
    applyUpdatedMemo(data.item);
    setStatus(
      data.item.deletable
        ? `Deletable: ${data.item.id}`
        : `Deletable off: ${data.item.id}`,
      false,
      "danger",
    );
  } catch (error) {
    if (!String(error.message).includes("HTTP 404")) {
      setStatus(`Del update error: ${error.message}`, true);
      return;
    }

    // Backward compatibility: old server without PATCH /deletable route.
    try {
      const fallback = await request(
        `/api/memos/${encodeURIComponent(item.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectName: item.projectName || "",
            memoType: item.memoType || "memo",
            threadTitle: item.threadTitle || "(no title)",
            memoBody: item.memoBody || " ",
            deletable: nextDeletable,
            pinned: Boolean(item.pinned),
          }),
        },
      );
      applyUpdatedMemo(fallback.item);
      setStatus("Del updated via fallback route", false, "danger");
    } catch (fallbackError) {
      setStatus(`Del update error: ${fallbackError.message}`, true);
    }
  }
}

async function loadMemos(options = {}) {
  const autoTriggered = Boolean(options.autoTriggered);
  if (autoTriggered && !state.autoRefreshEnabled) {
    return false;
  }
  const forceReload = Boolean(options.forceReload);
  const usageJob = Promise.resolve(false);
  loadMemoCounts({ forceReload });

  try {
    const selectFirst = Boolean(options.selectFirst);
    const params = new URLSearchParams();
    if (el.qInput.value.trim()) params.set("q", el.qInput.value.trim());
    if (el.projectInput.value.trim())
      params.set("projectName", el.projectInput.value.trim());
    if (el.typeSelect.value) params.set("memoType", el.typeSelect.value);
    if (currentStorageFilterKind())
      params.set("storageKind", currentStorageFilterKind());
    params.set("limit", "300");
    if (forceReload) params.set("nocache", "1");

    const data = await request(`/api/memos?${params.toString()}`);
    state.items = data.items || [];
    const markdownCssMemo = state.items.find((item) =>
      isMarkdownCssMemoItem(item),
    );
    if (markdownCssMemo) {
      syncMarkdownCssMemoState(markdownCssMemo);
      if (!isMarkdownCssMemoItem(selectedMemoItem())) {
        applyMarkdownCustomCss(state.markdownCssMemoBody);
      }
    }
    updateQuickMemoStateFromItems();
    try {
      await repairQuickMemoIfNeeded();
    } catch (error) {
      setStatus(`Quick Memo repair error: ${error.message || error}`, true);
    }
    updateQuickMemoStateFromItems();
    if (!state.quickMemoId && !state.quickMemoEnsuring) {
      ensureQuickMemoExists().catch((error) => {
        setStatus(`Quick Memo create error: ${error.message || error}`, true);
      });
    }
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
    if (
      state.selectedId &&
      !isSpecialPanelId(state.selectedId) &&
      !state.items.some((memo) => memo.id === state.selectedId)
    ) {
      state.selectedId = null;
    }
    if (
      !isSpecialPanelId(state.selectedId) &&
      !isQuickMemoSelected() &&
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
    if (!confirmDiscardEditorChanges()) return;
    const data = await request(`/api/memos/${encodeURIComponent(id)}`);
    fillEditor(
      isQuickMemoItem(data.item)
        ? normalizeQuickMemoItem(data.item)
        : data.item,
      {
        fromCache: state.lastResponseCacheHit,
        editorStorageKind: data.item?.storageKind,
      },
    );
  } catch (error) {
    setStatus(`Detail fetch error: ${error.message}`, true);
  }
}

async function saveMemo(ev) {
  if (isReadOnlyPanelSelected()) {
    setStatus("Usage panel is read-only", true);
    return;
  }
  if (isQuickMemoSelected()) {
    await saveQuickMemo({ saveAsNew: Boolean(ev?.shiftKey) });
    return;
  }
  const payload = currentPayload();
  const validationError = currentPayloadValidationError();
  if (validationError) {
    setStatus(validationError, true);
    return;
  }

  try {
    if (state.selectedId) {
      const data = await request(
        `/api/memos/${encodeURIComponent(state.selectedId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (isMarkdownCssMemoItem(data.item)) {
        applyMarkdownCustomCssFromMemo(data.item);
      }
      fillEditor(data.item, { fromCache: false });
      setStatus(`Updated: ${data.item.id}`);
    } else {
      const data = await request("/api/memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (isMarkdownCssMemoItem(data.item)) {
        applyMarkdownCustomCssFromMemo(data.item);
      }
      fillEditor(data.item, { fromCache: false });
      setStatus(`Created: ${data.item.id}`);
    }
    await loadMemos();
  } catch (error) {
    setStatus(`Save error: ${error.message}`, true);
  }
}

async function deleteSelectedMemo() {
  if (isQuickMemoSelected()) {
    setStatus("Quick Memo cannot be deleted", true);
    return;
  }
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
      const promoted = await request(
        `/api/memos/${encodeURIComponent(selected.id)}/deletable`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deletable: true }),
        },
      );
      applyUpdatedMemo(promoted.item);
    } catch (error) {
      setStatus(`DEL enable error: ${error.message}`, true);
      return;
    }
  }

  try {
    await request(`/api/memos/${encodeURIComponent(selected.id)}`, {
      method: "DELETE",
      headers: { "x-codex-delete-confirm": "DELETE" },
    });
    fillEditor(null);
    await loadMemos({ forceReload: true, selectFirst: true });
    setStatus(`Deleted: ${selected.id}`, false, "force");
  } catch (error) {
    setStatus(`Delete error: ${error.message}`, true);
  }
}

async function deleteAllDeletableMemos() {
  const targets = state.items.filter(
    (memo) => Boolean(memo.deletable) && !Boolean(memo.pinned),
  );
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
        headers: { "x-codex-delete-confirm": "DELETE" },
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
  if (isQuickMemoSelected()) {
    await clearQuickMemo();
    return;
  }
  if (ev && ev.shiftKey) {
    state.showOnlyDeletable = !state.showOnlyDeletable;
    syncDeleteButtonLabel();
    const visibleItems = getVisibleItemsSorted();
    if (
      state.showOnlyDeletable &&
      state.selectedId &&
      !isSpecialPanelId(state.selectedId) &&
      !isQuickMemoSelected() &&
      !visibleItems.some((memo) => memo.id === state.selectedId)
    ) {
      if (visibleItems.length > 0) {
        fillEditor(visibleItems[0], { fromCache: false });
      } else {
        fillEditor(null);
      }
    } else {
      renderList();
    }
    setStatus(
      state.showOnlyDeletable
        ? "Mode: ALL (deletable only)"
        : "Mode: Delete (all docs)",
      false,
      "force",
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
  const memo = currentMemoForExport();
  const body = buildShareBody(memo, format);
  const fileName = ensureFileNameExtension(
    buildThreadNameFileName(memo, format),
    format,
  );
  const typeMap = {
    txt: "text/plain;charset=utf-8",
    md: "text/markdown;charset=utf-8",
    json: "application/json;charset=utf-8",
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
}

function currentMemoForExport() {
  const selected =
    state.items.find((memo) => memo.id === state.selectedId) || {};
  return {
    id: selected.id || state.selectedId || "",
    projectName: el.projectNameInput.value.trim(),
    memoType: el.memoTypeInput.value || "memo",
    memoBody: el.memoBodyInput.value || "",
    threadTitle: el.threadTitleInput.value.trim(),
    storageKind: currentEditingStorageKind(),
    deletable: Boolean(selected.deletable),
    createdAtISO: selected.createdAtISO || "",
    updatedAtISO: selected.updatedAtISO || "",
    datetimeISO: selected.datetimeISO || "",
  };
}

function buildShareBody(memo, format) {
  const markdown = String(memo.memoBody || "");
  if (format === "md") {
    return markdown;
  }
  if (format === "json") {
    return JSON.stringify(markdownToStyledTextSegments(markdown), null, 2);
  }
  return markdownToPlainText(markdown);
}

function buildThreadNameFileName(memo, format) {
  const threadName = String(
    memo.threadTitle || memo.threadName || memo.id || "memo",
  ).trim();
  const base = sanitizeExportFileNameBase(threadName);
  return `${base}.${format}`;
}

function sanitizeExportFileNameBase(value) {
  const reserved = new Set([
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ]);
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  if (!normalized) return "memo";
  return reserved.has(normalized.toUpperCase())
    ? `${normalized}-memo`
    : normalized;
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
  const body = buildShareBody(memo, format);
  const fileName = ensureFileNameExtension(
    buildThreadNameFileName(memo, format),
    format,
  );
  const typeMap = {
    txt: "text/plain;charset=utf-8",
    md: "text/markdown;charset=utf-8",
    json: "application/json;charset=utf-8",
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
    setStatus(
      `${reasonText ? `${reasonText}. ` : ""}Downloaded ${format.toUpperCase()} file`,
    );
  };
  const copyAsFallback = async (reasonText) => {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      downloadAsFallback(
        reasonText
          ? `${reasonText} and Clipboard API unavailable`
          : "Clipboard API unavailable",
      );
      return;
    }
    await navigator.clipboard.writeText(body);
    setStatus(
      `${reasonText ? `${reasonText}. ` : ""}Copied ${format.toUpperCase()} text`,
    );
  };
  try {
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      await copyAsFallback("Web Share blocked (no active user gesture)");
      return;
    }

    if (
      window.self !== window.top &&
      document.permissionsPolicy &&
      !document.permissionsPolicy.allowsFeature("web-share")
    ) {
      await copyAsFallback(
        "Web Share blocked in iframe (allow=web-share required)",
      );
      return;
    }

    if (!navigator.share) {
      await copyAsFallback("Web Share unavailable");
      return;
    }

    if (typeof File !== "undefined" && navigator.canShare) {
      const file = new File([body], fileName, {
        type: typeMap[format] || typeMap.txt,
      });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: memo.threadTitle || "codex-memo",
            text: body,
            files: [file],
          });
          setStatus(`Shared ${format.toUpperCase()} file`);
          return;
        } catch (fileShareError) {
          const denied = String(fileShareError?.name || "").toLowerCase();
          if (
            denied === "notallowederror" ||
            denied === "permissiondeniederror"
          ) {
            console.warn(
              "[codex-memo] file share blocked; falling back to text share",
              fileShareError,
            );
          } else {
            throw fileShareError;
          }
        }
      }
    }

    await navigator.share({
      title: memo.threadTitle || "codex-memo",
      text: body,
    });
    setStatus(`Shared as ${format.toUpperCase()} text`);
  } catch (error) {
    if (error && error.name === "AbortError") {
      setStatus("Share cancelled");
      return;
    }
    const errorName = error && error.name ? String(error.name) : "UnknownError";
    const errorMessage =
      error && error.message ? String(error.message) : "no message";
    const reason = `Share failed (${errorName}: ${errorMessage})`;
    try {
      await copyAsFallback(reason);
    } catch (copyError) {
      setStatus(
        `Share error: ${reason}. ${copyError.message || copyError}`,
        true,
      );
    }
  }
}

async function summarizeMemoAtPointer(ev) {
  ev.preventDefault();
  ev.stopPropagation();
  rememberPointerPosition(ev);

  const memo = currentMemoForExport();
  const source = String(memo.memoBody || "").trim();
  if (!source) {
    hideSummaryTooltip();
    setStatus("Summary skipped: body is empty", true);
    return;
  }

  const reqId = ++summaryRequestSeq;
  const activeModel = getActiveSummaryModelName();
  showSummaryTooltip({
    head: `summary (${activeModel})`,
    body: "要約中...",
    isError: false,
    followPointer: true,
  });

  if (isUsageOverviewPanelSelected()) {
    try {
      showSummaryTooltip({
        head: `summary (${activeModel})`,
        body: "usage再取得中...",
        isError: false,
        followPointer: true,
      });
      setStatus("Usage stats refreshing for AI summary...");
      await refreshUsageStats({ forceReload: true, reason: "summary" });
      showSummaryTooltip({
        head: `summary (${activeModel})`,
        body: "要約中...",
        isError: false,
        followPointer: true,
      });
      if (reqId !== summaryRequestSeq) return;
      if (state.usageOverviewAiSummaryError) {
        showSummaryTooltip({
          head: "summary error",
          body: state.usageOverviewAiSummaryError,
          isError: true,
          followPointer: true,
        });
        renderSummaryButtonTooltip();
        setStatus(`Summary error: ${state.usageOverviewAiSummaryError}`, true);
        return;
      }
      showSummaryTooltip({
        head: `summary (${getActiveSummaryModelName()})`,
        body: state.usageOverviewAiSummary || "(empty)",
        isError: false,
        followPointer: true,
      });
      renderSummaryButtonTooltip();
      setStatus("Summary ready");
      return;
    } catch (error) {
      if (reqId !== summaryRequestSeq) return;
      showSummaryTooltip({
        head: "summary error",
        body: String(error.message || error || "Failed to summarize"),
        isError: true,
        followPointer: true,
      });
      renderSummaryButtonTooltip();
      setStatus(`Summary error: ${error.message || error}`, true);
      return;
    }
  }

  try {
    const res = await request("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadTitle: memo.threadTitle || "",
        memoBody: source,
      }),
    });
    if (reqId !== summaryRequestSeq) return;
    showSummaryTooltip({
      head: `summary (${res.model || "gpt-4.1-nano"})`,
      body: String(res.summary || "").trim() || "(empty)",
      isError: false,
      followPointer: true,
    });
    renderSummaryButtonTooltip(res.model || "gpt-4.1-nano");
    setStatus("Summary ready");
  } catch (error) {
    if (reqId !== summaryRequestSeq) return;
    showSummaryTooltip({
      head: "summary error",
      body: String(error.message || error || "Failed to summarize"),
      isError: true,
      followPointer: true,
    });
    setStatus(`Summary error: ${error.message || error}`, true);
  }
}

async function copyBodyText() {
  try {
    await copyTextToClipboard(el.memoBodyInput.value || "");
    setStatus("Copied body text");
  } catch (error) {
    setStatus(`Copy error: ${error.message}`, true);
  }
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      if (!document.queryCommandSupported?.("copy")) throw error;
    }
  }
  const active = document.activeElement;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (active && typeof active.focus === "function") active.focus();
  if (!copied) throw new Error("Clipboard copy was blocked");
}

async function copySelectedDocId() {
  const docId = String(el.copyDocIdBtn?.dataset?.docId || "").trim();
  if (!docId) return;
  try {
    await copyTextToClipboard(docId);
    setStatus(`Copied doc id: ${docId}`);
  } catch (error) {
    setStatus(`Copy error: ${error.message}`, true);
  }
}

function initEvents() {
  window.addEventListener("codex-memo:mermaid-ready", () => {
    if (getBodyMode() === "preview") renderMarkdownPreview();
  });
  if (el.memoSidebarScroll) {
    el.memoSidebarScroll.addEventListener("scroll", syncStickySlotDivider, {
      passive: true,
    });
  }
  document.addEventListener("mousemove", rememberPointerPosition, {
    passive: true,
  });
  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (
      state.attachmentListExpanded &&
      target &&
      target.closest &&
      !target.closest("#attachmentToggle") &&
      !target.closest("#attachmentList")
    ) {
      state.attachmentListExpanded = false;
      renderAttachmentList();
    }
    if (
      target &&
      target.closest &&
      (target.closest("#summaryBtn") || target.closest("#summaryTooltip"))
    ) {
      return;
    }
    hideSummaryTooltip();
    if (
      target &&
      target.closest &&
      (target.closest("#appMenuBtn") || target.closest("#appMenuPanel"))
    ) {
      return;
    }
    closeAppMenu();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (state.attachmentListExpanded) {
        state.attachmentListExpanded = false;
        renderAttachmentList();
      }
      hideSummaryTooltip();
      closeAppMenu();
    }
  });
  window.addEventListener("resize", () => {
    if (isAppMenuOpen()) positionAppMenu();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (isAppMenuOpen()) positionAppMenu();
    },
    { passive: true },
  );
  if (el.statusBanner) {
    el.statusBanner.addEventListener("click", hideStatusBanner);
  }
  if (el.appMenuBtn) {
    el.appMenuBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      toggleAppMenu();
    });
  }
  if (el.menuMemoFontBtn) {
    el.menuMemoFontBtn.addEventListener("click", () => {
      closeAppMenu();
      openFontSettingsDialog();
    });
  }
  if (el.menuMarkdownCssBtn) {
    el.menuMarkdownCssBtn.addEventListener("click", async () => {
      closeAppMenu();
      try {
        await openMarkdownCssMemo();
      } catch (error) {
        setStatus(`Markdown CSS memo error: ${error.message || error}`, true);
      }
    });
  }
  if (el.fontSettingsCancelBtn) {
    el.fontSettingsCancelBtn.addEventListener("click", () => {
      closeFontSettingsDialog();
    });
  }
  if (el.fontSettingsResetBtn) {
    el.fontSettingsResetBtn.addEventListener("click", () => {
      const prefs = saveFontPrefs(DEFAULT_FONT_PREFS);
      syncFontSettingsInputs(prefs);
      setStatus("Font settings reset", false, "force");
    });
  }
  if (el.fontSettingsDialog) {
    el.fontSettingsDialog.addEventListener("click", (ev) => {
      const rect = el.fontSettingsDialog.getBoundingClientRect();
      const inside =
        ev.clientX >= rect.left &&
        ev.clientX <= rect.right &&
        ev.clientY >= rect.top &&
        ev.clientY <= rect.bottom;
      if (!inside) closeFontSettingsDialog();
    });
    el.fontSettingsDialog.addEventListener("close", () => {
      syncFontSettingsInputs(loadFontPrefs());
    });
    el.fontSettingsDialog.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const prefs = saveFontPrefs(currentFontPrefsFromDialog());
      syncFontSettingsInputs(prefs);
      closeFontSettingsDialog();
      setStatus("Font settings saved", false, "force");
    });
  }
  [el.memoFontNameInput].filter(Boolean).forEach((input) => {
    input.title = "Double-click to open Font Book";
    input.addEventListener("dblclick", async (ev) => {
      ev.preventDefault();
      try {
        await openFontBookApp();
      } catch (error) {
        setStatus(`Font Book open error: ${error.message || error}`, true);
      }
    });
  });

  el.newBtn.addEventListener("click", () => {
    if (!confirmDiscardEditorChanges()) return;
    fillEditor(
      {
        projectName: "common",
        memoType: "memo",
        threadTitle: "",
        memoBody: "",
        storageKind: currentDefaultStorageKind(),
        attachments: [],
        deletable: false,
      },
      { editorStorageKind: currentDefaultStorageKind(), bodyMode: "text" },
    );
    el.threadTitleInput.focus();
    setStatus("New memo mode");
  });
  el.appTitle.addEventListener("dblclick", async () => {
    window.location.reload();
  });

  const onFilterEnter = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      maybeRunAutoRefresh(() => loadMemos({ autoTriggered: true }));
    }
  };
  const onFilterCleared = (ev) => {
    if (!String(ev.target.value || "").trim()) {
      maybeRunAutoRefresh(() => loadMemos({ autoTriggered: true }));
    }
  };
  el.qInput.addEventListener("keydown", onFilterEnter);
  el.projectInput.addEventListener("keydown", onFilterEnter);
  el.qInput.addEventListener("input", onFilterCleared);
  el.projectInput.addEventListener("input", onFilterCleared);
  // For search clear button (x) behavior on WebKit browsers.
  el.qInput.addEventListener("search", onFilterCleared);
  el.projectInput.addEventListener("search", onFilterCleared);
  el.typeSelect.addEventListener("change", () => {
    loadMemos({ forceReload: true }).catch((error) => {
      setStatus(`Load error: ${error.message || error}`, true);
    });
  });
  el.storageFilterSelect.addEventListener("change", () => {
    state.storageFilterKind = currentStorageFilterKind();
    loadMemos({ forceReload: true }).catch((error) => {
      setStatus(`Load error: ${error.message || error}`, true);
    });
  });
  el.autoRefreshIndicator.addEventListener("click", () => {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    renderAutoRefreshIndicator();
    setStatus(
      state.autoRefreshEnabled ? "Auto refresh ON" : "Auto refresh OFF",
      false,
      "force",
    );
  });
  el.modeBadge.addEventListener("click", showModeLaunchHint);
  el.defaultStorageSelect.addEventListener("change", () => {
    state.runtimeConfig.defaultStorageKind = selectedDefaultStorageKind();
    if (!state.selectedId && !isReadOnlyPanelSelected()) {
      setEditorStorageKind(state.runtimeConfig.defaultStorageKind);
    }
    renderStorageControls();
    if (!state.selectedId && !isReadOnlyPanelSelected()) {
      setStatus(
        `Next new memo: ${displayStorageKindLabel(currentDefaultStorageKind())}`,
      );
      renderStorageInfo(null);
      renderEditorDividerAccent(currentEditingStorageKind());
    }
    if (isSpecialPanelId(state.selectedId)) {
      renderStorageInfo({ storageKind: currentEditingStorageKind() });
    }
    updateSaveButtonState();
  });
  el.editStorageSelect.addEventListener("change", () => {
    setEditorStorageKind(el.editStorageSelect.value);
    renderStorageControls();
    renderStorageInfo({ storageKind: currentEditingStorageKind() });
    renderEditorDividerAccent(currentEditingStorageKind());
    updateSaveButtonState();
    setStatus(
      `Change on save: ${displayStorageKindLabel(currentEditingStorageKind())}`,
    );
  });
  el.bodyModeToggle.addEventListener("click", () => {
    setBodyMode(getBodyMode() === "preview" ? "text" : "preview");
    updateBodyMode();
  });
  el.addImageBtn.addEventListener("click", () => {
    if (isReadOnlyPanelSelected()) {
      setStatus("Usage panel is read-only", true);
      return;
    }
    el.attachmentInput.value = "";
    el.attachmentInput.click();
  });
  el.attachmentToggle.addEventListener("click", () => {
    state.attachmentListExpanded = !state.attachmentListExpanded;
    renderAttachmentList();
  });
  el.attachmentInput.addEventListener("change", async (ev) => {
    try {
      await addImageFiles(ev.target.files);
    } catch (error) {
      setStatus(`Attachment add error: ${error.message}`, true);
    } finally {
      ev.target.value = "";
    }
  });
  el.memoBodyInput.addEventListener("input", () => {
    if (isMarkdownCssMemoItem(selectedMemoItem())) {
      applyMarkdownCustomCss(el.memoBodyInput.value || "");
    }
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
    const refsTrigger =
      ev.target && ev.target.closest
        ? ev.target.closest("a[data-open-usage-refs]")
        : null;
    if (refsTrigger) {
      ev.preventDefault();
      openUsageRefs();
      setStatus("Opened usage refs");
      return;
    }
    const imageTarget =
      ev.target && ev.target.closest ? ev.target.closest("img") : null;
    if (imageTarget && imageTarget.getAttribute("src")) {
      ev.preventDefault();
      showAttachmentLightbox(
        imageTarget.getAttribute("src"),
        imageTarget.getAttribute("alt") || "",
      );
      return;
    }
    const target =
      ev.target && ev.target.closest
        ? ev.target.closest("a[data-local-path]")
        : null;
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
  el.memoPreview.addEventListener("dblclick", (ev) => {
    const hasLinkTarget =
      ev.target && ev.target.closest && ev.target.closest("a");
    const hasImageTarget =
      ev.target && ev.target.closest && ev.target.closest("img");
    if (
      hasLinkTarget ||
      hasImageTarget ||
      getBodyMode() !== "preview" ||
      isReadOnlyPanelSelected()
    )
      return;
    setBodyMode("text");
    updateBodyMode();
    el.memoBodyInput.focus();
    requestAnimationFrame(() => {
      el.memoBodyInput.setSelectionRange(0, 0);
      el.memoBodyInput.scrollTop = 0;
      el.memoBodyInput.scrollLeft = 0;
    });
  });
  const dropTargets = [
    el.memoBodyInput,
    el.memoPreview,
    el.attachmentList,
  ].filter(Boolean);
  dropTargets.forEach((node) => {
    node.addEventListener("dragenter", (ev) => {
      if (!canAcceptEditorImageInput()) return;
      if (
        filesFromDataTransfer(ev.dataTransfer).length === 0 &&
        !hasUrlDataTransferType(ev.dataTransfer)
      )
        return;
      ev.preventDefault();
      setDropHint(true);
    });
    node.addEventListener("dragover", (ev) => {
      if (!canAcceptEditorImageInput()) return;
      if (
        filesFromDataTransfer(ev.dataTransfer).length === 0 &&
        !hasUrlDataTransferType(ev.dataTransfer)
      )
        return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
      setDropHint(true);
    });
    node.addEventListener("dragleave", (ev) => {
      if (!ev.currentTarget.contains(ev.relatedTarget)) {
        setDropHint(false);
      }
    });
    node.addEventListener("drop", async (ev) => {
      if (!canAcceptEditorImageInput()) return;
      const files = filesFromDataTransfer(ev.dataTransfer);
      const hasUrlPayload = hasUrlDataTransferType(ev.dataTransfer);
      if (files.length === 0 && !hasUrlPayload) return;
      ev.preventDefault();
      setDropHint(false);
      if (files.length === 0) {
        if (!insertDroppedUrlLink(ev.dataTransfer)) {
          setStatus("Dropped URL not found", true);
        }
        return;
      }
      try {
        await addImageFiles(files);
        setStatus(
          `Added ${files.length} attachment${files.length > 1 ? "s" : ""} by drop`,
        );
      } catch (error) {
        setStatus(`Attachment drop error: ${error.message}`, true);
      }
    });
  });
  document.addEventListener("drop", () => setDropHint(false));
  document.addEventListener("dragend", () => setDropHint(false));
  document.addEventListener("paste", async (ev) => {
    if (!canAcceptEditorImageInput()) return;
    const active = document.activeElement;
    const editing =
      active === el.memoBodyInput ||
      active === el.memoPreview ||
      active === el.threadTitleInput;
    if (!editing) return;
    const files = filesFromDataTransfer(ev.clipboardData);
    if (files.length === 0) return;
    ev.preventDefault();
    try {
      await addImageFiles(files);
      setStatus(
        `Added ${files.length} attachment${files.length > 1 ? "s" : ""} from paste`,
      );
    } catch (error) {
      setStatus(`Attachment paste error: ${error.message}`, true);
    }
  });
  el.projectNameInput.addEventListener("input", updateSaveButtonState);
  el.threadTitleInput.addEventListener("input", updateSaveButtonState);
  el.memoTypeInput.addEventListener("change", updateSaveButtonState);

  el.saveBtn.addEventListener("click", saveMemo);
  el.deleteBtn.addEventListener("click", deleteMemo);
  el.downloadBtn.addEventListener("click", () =>
    downloadMemo(el.downloadFormatSelect.value || "txt"),
  );
  el.copyBodyBtn.addEventListener("click", copyBodyText);
  el.copyDocIdBtn.addEventListener("click", copySelectedDocId);
  el.shareBtn.addEventListener("click", shareMemo);
  el.summaryBtn.addEventListener("click", summarizeMemoAtPointer);
}

initEvents();
loadFontPrefs();
fillEditor(null);
setBodyMode("preview");
updateBodyMode();
renderAutoRefreshIndicator();
renderSummaryButtonTooltip();
syncStickySlotDivider();

async function initApp() {
  try {
    await loadRuntimeConfig();
    renderStorageInfo(null);
    await loadPersistedUsageOverview();
    await loadMemos();
    const markdownCssMemo = await findMarkdownCssMemo().catch(() => null);
    applyMarkdownCustomCssFromMemo(markdownCssMemo);
    await ensureQuickMemoExists();
  } catch (error) {
    setStatus(`Init error: ${error.message}`, true);
  }
}

initApp();

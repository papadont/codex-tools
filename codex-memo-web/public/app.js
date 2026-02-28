const state = {
  items: [],
  selectedId: null,
  runtimeConfig: {
    storageMode: "mixed",
    fixedAdapter: null,
    defaultStorageKind: "firebase",
    availableAdapters: ["icloud", "firebase"],
    allowedAdapters: ["icloud", "firebase"],
    adapterDetails: []
  },
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
  editorAttachments: [],
  pointerClientX: 0,
  pointerClientY: 0
};

const USAGE_OVERVIEW_PANEL_ID = "__usage_overview__";
const CODEX_USAGE_PANEL_ID = "__codex_usage__";
const USAGE_PANEL_ID = "__firestore_usage__";
const USAGE_PANEL_HOURS = 24 * 14;
const USAGE_FETCH_TIMEOUT_MS = 8000;
const FIREBASE_USAGE_PAGE_URL = "https://console.firebase.google.com/project/hush-pointer/firestore/databases/-default-/usage/prev-24h";
const STORAGE_USAGE_PAGE_URL = "https://console.firebase.google.com/project/hush-pointer/storage";
const CODEX_USAGE_PAGE_URL = "https://chatgpt.com/codex/settings/usage";
const OPENAI_USAGE_PAGE_URL = "https://platform.openai.com/usage";
const FIRESTORE_USAGE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const STORAGE_USAGE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const OPENAI_COSTS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CODEX_USAGE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

let usageRefreshInFlight = null;
let usageOverviewSummaryInFlight = null;
let attachmentLightbox = null;

function usageSourceFooterLines() {
  return [
    "",
    `<small><a href="#" class="usage-refs-trigger" data-open-usage-refs="1">refs:</a> [firestore usage](${FIREBASE_USAGE_PAGE_URL}) | [storage](${STORAGE_USAGE_PAGE_URL}) | [codex usage](${CODEX_USAGE_PAGE_URL}) | [openai usage](${OPENAI_USAGE_PAGE_URL})</small>`
  ];
}

const el = {
  memoList: document.getElementById("memoList"),
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
  addImageBtn: document.getElementById("addImageBtn"),
  attachmentInput: document.getElementById("attachmentInput"),
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
  status: document.getElementById("status")
};

let summaryTooltipEl = null;
let summaryRequestSeq = 0;

async function request(path, options) {
  const res = await fetch(path, options);
  state.lastResponseCacheHit = String(res.headers.get("X-Cache") || "").toUpperCase() === "HIT";
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
    defaultStorageKind: normalizeStorageKind(data.defaultStorageKind, "firebase"),
    availableAdapters: Array.isArray(data.availableAdapters) && data.availableAdapters.length
      ? data.availableAdapters.map((item) => normalizeStorageKind(item))
      : ["icloud", "firebase"],
    allowedAdapters: Array.isArray(data.allowedAdapters) && data.allowedAdapters.length
      ? data.allowedAdapters.map((item) => normalizeStorageKind(item))
      : ["icloud", "firebase"],
    adapterDetails: Array.isArray(data.adapterDetails) ? data.adapterDetails : []
  };
  renderStorageControls();
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

function renderAutoRefreshIndicator() {
  if (!el.autoRefreshIndicator) return;
  el.autoRefreshIndicator.title = state.autoRefreshEnabled
    ? "Auto refresh ON"
    : "Auto refresh OFF";
  el.autoRefreshIndicator.setAttribute("aria-pressed", state.autoRefreshEnabled ? "true" : "false");
  el.autoRefreshIndicator.className = state.autoRefreshEnabled
    ? "h-3 w-3 rounded-full border border-[#8eb991] bg-[#8fcf95] shadow-[0_0_0_1px_rgba(255,255,255,0.55)_inset,0_0_5px_rgba(143,207,149,0.55)]"
    : "h-3 w-3 rounded-full border border-[#bfc6d1] bg-[#e7eaf0]";
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
  tip.className = "fixed z-[120] hidden max-w-[min(420px,calc(100vw-24px))] rounded-xl border border-[#4b5563] bg-[#4b5563] px-3 py-2 shadow-sm";
  tip.style.pointerEvents = "none";
  tip.style.whiteSpace = "pre-wrap";
  tip.style.lineHeight = "1.45";
  tip.style.color = "#e5e7eb";
  tip.style.fontSize = "12px";
  tip.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.18)";

  const head = document.createElement("div");
  head.className = "mb-1 text-[10px] font-semibold tracking-wide text-[#cbd5e1]";
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
  if (top + rect.height + pad > vh) top = Math.max(pad, Number(y || 0) - rect.height - 12);
  tip.style.left = `${Math.max(pad, left)}px`;
  tip.style.top = `${Math.max(pad, top)}px`;
}

function showSummaryTooltip({ head, body, isError = false, followPointer = true }) {
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
  if (summaryTooltipEl && !summaryTooltipEl.classList.contains("hidden") && summaryTooltipEl.dataset.followPointer === "1") {
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
  const ss = pad2(date.getSeconds());
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
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
      border: "border-[#b7aeca]",
      bg: "bg-transparent",
      text: "text-[#8a5f74]"
    };
  }
  switch (normalizeStorageKind(value)) {
    case "icloud":
      return {
        border: "border-[#bdd1e8]",
        bg: "bg-transparent",
        text: "text-[#5678a3]"
      };
    default:
      return {
        border: "border-[#d6c3ac]",
        bg: "bg-transparent",
        text: "text-[#8b6644]"
      };
  }
}

function currentRuntimeConfig() {
  return state.runtimeConfig || {
    storageMode: "mixed",
    fixedAdapter: null,
    defaultStorageKind: "firebase",
    availableAdapters: ["icloud", "firebase"],
    allowedAdapters: ["icloud", "firebase"],
    adapterDetails: []
  };
}

function currentAllowedAdapters() {
  return currentRuntimeConfig().allowedAdapters || ["icloud", "firebase"];
}

function storagePathFor(kind) {
  const details = currentRuntimeConfig().adapterDetails || [];
  const found = details.find((item) => normalizeStorageKind(item.kind) === normalizeStorageKind(kind));
  return found?.path || "";
}

function currentDefaultStorageKind() {
  return normalizeStorageKind(currentRuntimeConfig().defaultStorageKind, "firebase");
}

function selectedDefaultStorageKind() {
  return normalizeStorageKind(el.defaultStorageSelect?.value || currentDefaultStorageKind(), currentDefaultStorageKind());
}

function currentEditingStorageKind() {
  return normalizeStorageKind(state.editorStorageKind, currentDefaultStorageKind());
}

function setEditorStorageKind(value) {
  state.editorStorageKind = normalizeStorageKind(value, currentDefaultStorageKind());
}

function currentEditableStorageOptions() {
  return currentAllowedAdapters().filter((kind) => kind === "icloud" || kind === "firebase");
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
  return {
    id: String(item.id),
    kind: item.kind || "image",
    fileName: item.fileName ? String(item.fileName) : "",
    mimeType: item.mimeType || "application/octet-stream",
    size: Number(item.size || 0),
    caption: item.caption ? String(item.caption) : "",
    width: item.width === undefined ? undefined : Number(item.width),
    height: item.height === undefined ? undefined : Number(item.height),
    storagePath: item.storagePath ? String(item.storagePath) : "",
    previewUrl: item.previewUrl ? String(item.previewUrl) : "",
    dataUrl: item.dataUrl ? String(item.dataUrl) : "",
    createdAtISO: item.createdAtISO ? String(item.createdAtISO) : new Date().toISOString()
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
      hasDataUrl: Boolean(item.dataUrl)
    }))
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
  if (item?.storagePath && /^\/(?:Users|tmp|var)\//.test(String(item.storagePath))) {
    return displayStorageKindLabel("icloud");
  }
  return displayStorageKindLabel(currentEditingStorageKind());
}

function attachmentTooltipText(item) {
  return [
    item.fileName || item.id,
    item.width && item.height ? `${item.width}x${item.height}` : "",
    formatAttachmentSize(item.size),
    attachmentStorageLabel(item)
  ].filter(Boolean).join(" / ");
}

function bodyContainsAttachment(attachmentId) {
  const escapedId = String(attachmentId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`!\\[[^\\]]*\\]\\(attachment:\\/\\/${escapedId}\\)`);
  return pattern.test(String(el.memoBodyInput.value || ""));
}

function renderAttachmentList() {
  if (!el.attachmentList) return;
  const attachments = currentEditorAttachments();
  el.attachmentList.innerHTML = "";
  if (!attachments.length) {
    el.attachmentList.classList.add("hidden");
    return;
  }
  el.attachmentList.classList.remove("hidden");

  attachments.forEach((item) => {
    const chip = document.createElement("div");
    chip.className = "inline-flex max-w-full items-center gap-0.5 rounded-md border border-[#e6dfd5] bg-[#fffefd] px-1 py-0.5 text-[10px] leading-none text-[#5e6f8d]";
    chip.title = attachmentTooltipText(item);

    const thumbUrl = attachmentPreviewUrl(item);
    if (thumbUrl) {
      const thumb = document.createElement("img");
      thumb.src = thumbUrl;
      thumb.alt = item.caption || item.fileName || item.id;
      thumb.className = "h-3.5 w-3.5 rounded-[3px] object-cover";
      thumb.title = chip.title;
      chip.appendChild(thumb);
    }

    const label = document.createElement("span");
    label.className = "max-w-[110px] truncate leading-none";
    label.textContent = item.fileName || item.caption || item.id;
    label.title = chip.title;
    chip.appendChild(label);

    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.className = "inline-flex h-4 w-4 items-center justify-center rounded text-[#6f7f9b] hover:text-[#5a6f94]";
    insertBtn.textContent = "+";
    insertBtn.title = bodyContainsAttachment(item.id) ? "Image already inserted" : "Insert image into body";
    insertBtn.disabled = isReadOnlyPanelSelected();
    insertBtn.addEventListener("click", () => {
      insertAttachmentMarkdown(item);
      updateSaveButtonState();
      renderAttachmentList();
      if (getBodyMode() === "preview") {
        renderMarkdownPreview();
      }
      el.memoBodyInput.focus();
      setStatus(`Inserted image: ${item.fileName || item.id}`);
    });
    chip.appendChild(insertBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "inline-flex h-4 w-4 items-center justify-center rounded text-[#9c6b7e] hover:text-[#cf7896]";
    removeBtn.textContent = "x";
    removeBtn.title = "Remove image";
    removeBtn.disabled = isReadOnlyPanelSelected();
    removeBtn.addEventListener("click", () => {
      state.editorAttachments = currentEditorAttachments().filter((attachment) => attachment.id !== item.id);
      removeAttachmentMarkdown(item.id);
      updateSaveButtonState();
      renderAttachmentList();
      if (getBodyMode() === "preview") {
        renderMarkdownPreview();
      }
      setStatus(`Removed image: ${item.fileName || item.id}`);
    });
    chip.appendChild(removeBtn);
    el.attachmentList.appendChild(chip);
  });
}

function insertAttachmentMarkdown(item) {
  const token = `![${item.caption || item.fileName || item.id}](attachment://${item.id})`;
  if (bodyContainsAttachment(item.id)) return;
  const input = el.memoBodyInput;
  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : input.value.length;
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
  const pattern = new RegExp(`!?\\[[^\\]]*\\]\\(attachment:\\/\\/${escapedId}\\)\\n?`, "g");
  el.memoBodyInput.value = String(el.memoBodyInput.value || "").replace(pattern, "").replace(/\n{3,}/g, "\n\n");
}

function loadImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
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
  const files = Array.from(fileList || []).filter((file) => String(file.type || "").startsWith("image/"));
  if (!files.length) {
    setStatus("Image file not found", true);
    return;
  }

  for (const file of files) {
    const dataUrl = await readFileAsDataUrl(file);
    const dimensions = await loadImageDimensions(dataUrl);
    const attachment = normalizeEditorAttachment({
      id: generateAttachmentId(),
      kind: "image",
      fileName: file.name || "",
      mimeType: file.type || "application/octet-stream",
      size: Number(file.size || 0),
      caption: file.name ? String(file.name).replace(/\.[^.]+$/, "") : "",
      width: dimensions.width,
      height: dimensions.height,
      dataUrl
    });
    state.editorAttachments = [...currentEditorAttachments(), attachment];
    insertAttachmentMarkdown(attachment);
  }

  renderAttachmentList();
  updateSaveButtonState();
  if (getBodyMode() === "preview") {
    renderMarkdownPreview();
  }
  setStatus(`Added ${files.length} image${files.length > 1 ? "s" : ""}`);
}

function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer || !dataTransfer.files) return [];
  return Array.from(dataTransfer.files).filter((file) => String(file.type || "").startsWith("image/"));
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
  overlay.className = "fixed inset-0 z-[120] hidden items-center justify-center bg-[rgba(20,24,31,0.72)] px-6 py-6";
  overlay.innerHTML = [
    '<button type="button" data-lightbox-close="1" class="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.08)] text-sm text-white">x</button>',
    '<img data-lightbox-image="1" alt="" class="max-h-full max-w-full rounded-lg border border-[rgba(255,255,255,0.16)] bg-white/5 object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]" />'
  ].join("");
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay || ev.target.closest("[data-lightbox-close='1']")) {
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
    image: overlay.querySelector("[data-lightbox-image='1']")
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
  return isUsageOverviewPanelSelected() || isUsagePanelSelected() || isCodexUsagePanelSelected();
}

function isSpecialPanelId(id) {
  return id === USAGE_OVERVIEW_PANEL_ID || id === USAGE_PANEL_ID || id === CODEX_USAGE_PANEL_ID;
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
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
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

function getUsageOverviewFetchedAtISO() {
  const fsISO = state.usageFetchedAtISO || state.usageSummary?.endTime || "";
  const codexISO = state.codexUsageFetchedAtISO || state.codexUsageSummary?.fetchedAtISO || "";
  const storageISO = state.storageUsageFetchedAtISO || state.storageUsageSummary?.fetchedAtISO || "";
  const openaiISO = state.openaiCostsFetchedAtISO || state.openaiCostsSummary?.fetchedAtISO || "";
  const candidates = [fsISO, codexISO, storageISO, openaiISO]
    .map((value) => ({ value, ms: value ? new Date(value).getTime() : NaN }))
    .filter((item) => Number.isFinite(item.ms))
    .sort((a, b) => a.ms - b.ms);
  if (candidates.length) {
    return candidates[0].value;
  }
  return "";
}

function boldPercent(value, digits = 1) {
  return `**${formatPercent(value, digits)}**`;
}

function quoteMarkdownLines(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => String(line).replace(/^\s*>\s?/, ""))
    .map((line) => `> ${line}`);
}

function getUsageOverviewSummaryKey() {
  if (!state.usageSummary || !state.codexUsageSummary) return "";
  const fsPerDay = Array.isArray(state.usageSummary.perDay) ? state.usageSummary.perDay : [];
  const last = fsPerDay[fsPerDay.length - 1] || null;
  return JSON.stringify({
    fsEnd: state.usageSummary.endTime || "",
    fsLastDate: last?.date || "",
    fsLastTotal: Number(last?.total || 0),
    storageFetched: state.storageUsageSummary?.fetchedAtISO || "",
    storageBytes: Number(state.storageUsageSummary?.current?.totalBytes || 0),
    storageEgress30d: Number(state.storageUsageSummary?.last30d?.egressBytes || 0),
    openaiFetched: state.openaiCostsSummary?.fetchedAtISO || "",
    openaiTotalUsd30d: Number(state.openaiCostsSummary?.totalUsd30d || 0),
    codexFetched: state.codexUsageSummary.fetchedAtISO || "",
    codexWeeklyReset: state.codexUsageSummary?.secondaryWindow?.resetAtISO || "",
    codexWeeklyRemaining: Number(state.codexUsageSummary?.secondaryWindow?.remainingPercent ?? -1),
    roughUsdMonthly: Number(getRoughMonthlyCostSnapshot().totalUsd || 0)
  });
}

async function refreshUsageOverviewSummaryIfNeeded(options = {}) {
  const forceReload = Boolean(options.forceReload);
  if (!state.usageSummary || !state.codexUsageSummary) return;
  if (state.usageError || state.codexUsageError) return;
  const key = getUsageOverviewSummaryKey();
  if (!key) return;
  if (!forceReload && state.usageOverviewAiSummaryKey === key && (state.usageOverviewAiSummary || state.usageOverviewAiSummaryError)) {
    return;
  }
  if (!forceReload && usageOverviewSummaryInFlight) return usageOverviewSummaryInFlight;

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
          roughCostSummary: getRoughMonthlyCostSnapshot()
        })
      });
      state.usageOverviewAiSummary = String(result.summary || "").trim();
      state.usageOverviewAiSummaryModel = String(result.model || "").trim();
      state.usageOverviewAiSummaryError = "";
      state.usageOverviewAiSummaryKey = key;
    } catch (error) {
      state.usageOverviewAiSummary = "";
      state.usageOverviewAiSummaryModel = "";
      state.usageOverviewAiSummaryError = String(error.message || error || "Failed to summarize usage overview");
      state.usageOverviewAiSummaryKey = key;
    } finally {
      if (state.selectedId === USAGE_OVERVIEW_PANEL_ID) {
        fillEditor(buildUsageOverviewPanelItem(), { fromCache: false });
      }
    }
  })().finally(() => {
    usageOverviewSummaryInFlight = null;
  });

  return usageOverviewSummaryInFlight;
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

function getStorageSnapshot() {
  const summary = state.storageUsageSummary || null;
  const estimate = summary?.estimate || {};
  const percent = estimate.percentOfNoCost || {};
  const noCost = summary?.noCost || {};
  const peak = Math.max(
    Number(percent.storage || 0),
    Number(percent.download || 0),
    Number(percent.classA || 0),
    Number(percent.classB || 0)
  );
  return {
    peakPercent: peak,
    bytes: Number(summary?.current?.totalBytes || 0),
    objects: Number(summary?.current?.totalObjects || 0),
    egressBytes30d: Number(summary?.last30d?.egressBytes || 0),
    storageLimitGb: Number(noCost.storageGbMonths || 0),
    requestCounts: summary?.last30d?.requestCounts || { classA: 0, classB: 0, other: 0, total: 0 },
    estimatedMonthlyUsd: Number(estimate.estimatedMonthlyUsd || 0),
    bucketKind: summary?.bucketKind || "-",
    percentOfNoCost: {
      storage: Number(percent.storage || 0),
      download: Number(percent.download || 0),
      classA: Number(percent.classA || 0),
      classB: Number(percent.classB || 0)
    }
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
    budgetStateText: budgetJpy > 0
      ? `${formatUsd(totalUsd, 2)} / ref ¥${budgetJpy.toLocaleString()}`
      : formatUsd(totalUsd, 2)
  };
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
    usdToJpy
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
    remainingDays: Math.max(0, daysInMonth - day)
  };
}

function buildUsageOverviewBody() {
  const fs = getFirestoreTodaySnapshot();
  const storage = getStorageSnapshot();
  const openai = getOpenAISnapshot();
  const roughCost = getRoughMonthlyCostSnapshot();
  const codexSecondary = state.codexUsageSummary?.secondaryWindow || null;
  const monthPace = getMonthPaceInfo();
  const fetchedAtISO = getUsageOverviewFetchedAtISO();
  const fsPerDay = Array.isArray(state.usageSummary?.perDay) ? state.usageSummary.perDay : [];
  const fs14Desc = [...fsPerDay]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 14);

  const lines = [`<small>fetched: ${formatDate(fetchedAtISO)}</small>`];
  if (state.usageOverviewAiSummary) {
    lines.push(...quoteMarkdownLines(state.usageOverviewAiSummary));
  }
  lines.push(
    "",
    `- rough total monthly cost: **${formatJpy(roughCost.totalJpy, 0)}** / redline ¥3000 (Storage ${formatJpy(roughCost.storageJpy, 0)} + OpenAI ${formatJpy(roughCost.openaiJpy, 0)})`,
    "",
    "## Codex",
    "",
    state.codexUsageSummary
      ? `- weekly remaining: ${boldPercent(codexSecondary?.remainingPercent, 0)} reset: ${resetDateText(codexSecondary)}`
      : `- status: ${state.codexUsageError ? `error (${state.codexUsageError})` : "loading"}`,
    state.codexUsageSummary
      ? `- next resetまで: ${formatDuration(state.codexUsageSummary?.secondaryWindow?.resetAfterSeconds || 0)} / used ${boldPercent(codexSecondary?.usedPercent, 0)}`
      : "- next resetまで: -",
    "",
    "## OpenAI API",
    "",
    state.openaiCostsSummary
      ? state.openaiCostsSummary.available
        ? `- month-to-date: **${formatJpy(roughCost.openaiJpy, 0)}** / today ${monthPace.dayOfMonth}/${monthPace.daysInMonth}`
        : `- status: unavailable (${state.openaiCostsSummary.reason || "-"})`
      : `- status: ${state.openaiCostsError ? `error (${state.openaiCostsError})` : "loading"}`,
    state.openaiCostsSummary && state.openaiCostsSummary.available
      ? `- month-end rough: ${formatJpy((roughCost.openaiJpy / Math.max(0.001, monthPace.elapsedRatio)), 0)} if current pace continues`
      : "- month-end rough: -",
    "",
    "## Storage",
    "",
    state.storageUsageSummary
      ? `- now: ${formatBytes(storage.bytes)} / objects ${formatNumberCompact(storage.objects)}`
      : `- status: ${state.storageUsageError ? `error (${state.storageUsageError})` : "loading"}`,
    state.storageUsageSummary
      ? `- no-cost usage: storage ${boldPercent(storage.percentOfNoCost.storage, 1)} / egress ${boldPercent(storage.percentOfNoCost.download, 1)} / A ${boldPercent(storage.percentOfNoCost.classA, 1)} / B ${boldPercent(storage.percentOfNoCost.classB, 1)}`
      : "- no-cost usage: -",
    state.storageUsageSummary
      ? `- pace: 30d egress ${formatBytes(storage.egressBytes30d)} / rough overage ${formatJpy(roughCost.storageJpy, 0)} mo`
      : "- rough overage estimate: -",
    "",
    "## Firestore",
    "",
    state.usageSummary
      ? `- free-tier: R ${boldPercent(fs.ratePercent.read, 1)} / W ${boldPercent(fs.ratePercent.write, 1)} / D ${boldPercent(fs.ratePercent.delete, 1)}`
      : `- status: ${state.usageError ? `error (${state.usageError})` : "loading"}`,
    state.usageSummary
      ? `- pace vs free-tier: R ${boldPercent(fs.relativePercent.read, 0)} / W ${boldPercent(fs.relativePercent.write, 0)} / D ${boldPercent(fs.relativePercent.delete, 0)} of recent peak`
      : "- pace vs free-tier: -",
    "",
    "### Firestore 14d details",
    "",
    "| date (UTC) | read | write | delete | total |",
    "| --- | ---: | ---: | ---: | ---: |"
  );

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
    memoBody: el.memoBodyInput.value.trim(),
    storageKind: currentEditingStorageKind(),
    attachments: currentEditorAttachments()
  };
}

function currentEditorSnapshot() {
  return {
    projectName: el.projectNameInput.value,
    memoType: el.memoTypeInput.value,
    threadTitle: el.threadTitleInput.value,
    memoBody: el.memoBodyInput.value,
    storageKind: currentEditingStorageKind(),
    attachments: attachmentsSnapshotValue()
  };
}

function hasRequiredPayloadFields() {
  return Boolean(
    el.projectNameInput.value.trim() &&
    el.threadTitleInput.value.trim() &&
    el.memoBodyInput.value.trim()
  );
}

function currentPayloadValidationError() {
  if (!hasRequiredPayloadFields()) {
    return "projectName / threadTitle / memoBody are required";
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
  el.modeBadge.textContent = config.storageMode === "fixed"
    ? displayStorageKindLabel(config.fixedAdapter)
    : "Mixed";
  const badgeTone = modeBadgeClass(config.fixedAdapter, config.storageMode);
  el.modeBadge.classList.remove(
    "border-[#b7aeca]",
    "bg-transparent",
    "text-[#8a5f74]",
    "border-[#c8ced6]",
    "text-[#5e6877]",
    "border-[#bdd1e8]",
    "text-[#5678a3]",
    "border-[#d6c3ac]",
    "text-[#8b6644]"
  );
  el.modeBadge.classList.add(badgeTone.border, badgeTone.bg, badgeTone.text);
  const tooltipLines = config.storageMode === "fixed"
    ? [
      `Mode: fixed`,
      `Storage: ${displayStorageKindLabel(config.fixedAdapter)}`,
      storagePathFor(config.fixedAdapter)
    ].filter(Boolean)
    : [
      "Mode: mixed",
      `Default: ${displayStorageKindLabel(currentDefaultStorageKind())}`,
      ...allowed.map((kind) => `${displayStorageKindLabel(kind)}: ${storagePathFor(kind)}`)
    ].filter(Boolean);
  el.modeBadge.title = tooltipLines.join("\n");

  el.storageFilterSelect.innerHTML = '<option value="">Storages</option>';
  for (const kind of allowed) {
    const option = document.createElement("option");
    option.value = kind;
    option.textContent = displayStorageKindLabel(kind);
    el.storageFilterSelect.appendChild(option);
  }
  if (currentStorageFilterKind() && allowed.includes(currentStorageFilterKind())) {
    el.storageFilterSelect.value = currentStorageFilterKind();
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
  const selectedStorageKind = normalizeStorageKind(selectedMemo?.storageKind, "");
  const showEditSelector = Boolean(
    state.selectedId
    && !isSpecialPanelId(state.selectedId)
    && config.storageMode === "mixed"
    && editableStorageOptions.length > 1
    && (selectedStorageKind === "icloud" || selectedStorageKind === "firebase")
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
    "npm run memo:web:firebase"
  ];
}

async function showModeLaunchHint() {
  const lines = launchCommandLinesForCurrentMode();
  const message = [
    "Launch commands",
    ...lines
  ].join("\n");
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
            const firstItem = Array.isArray(token.items) ? token.items[0] : null;
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
          if (!token || token.ordered || typeof rendered !== "string") return rendered;
          const marker = String(token._codexListMarker || "");
          const cls = marker === "-" ? "md-list-dash" : marker === "*" ? "md-list-bullet" : "";
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
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|ftp|tel|attachment):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });
  }
  return html || "<p></p>";
}

function applyAttachmentPreviewLinks(root) {
  if (!root) return;
  const attachments = new Map(currentEditorAttachments().map((item) => [item.id, item]));
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
      node.setAttribute("data-local-path", "");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
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
  if (window.CodexMemoMarkdownTheme && typeof window.CodexMemoMarkdownTheme.apply === "function") {
    window.CodexMemoMarkdownTheme.apply(root);
  }
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
        textDecoration: computed.textDecorationLine || computed.textDecoration || "none"
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
    const ta = new Date(a.updatedAtISO || a.datetimeISO || a.createdAtISO || 0).getTime();
    const tb = new Date(b.updatedAtISO || b.datetimeISO || b.createdAtISO || 0).getTime();
    return tb - ta;
  });
}

function listItemsForView() {
  let items = state.items;
  const storageFilterKind = currentStorageFilterKind();
  if (storageFilterKind) {
    items = items.filter((item) => normalizeStorageKind(item.storageKind) === storageFilterKind);
  }
  if (!state.showOnlyDeletable) {
    return items;
  }
  return items.filter((item) => Boolean(item.deletable));
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
    return { refreshFirestore: true, refreshCodex: true, refreshStorage: true, refreshOpenAI: true };
  }
  return {
    refreshFirestore: shouldRefreshByAge(state.usageFetchedAtISO, FIRESTORE_USAGE_REFRESH_INTERVAL_MS),
    refreshCodex: shouldRefreshByAge(state.codexUsageFetchedAtISO, CODEX_USAGE_REFRESH_INTERVAL_MS),
    refreshStorage: shouldRefreshByAge(state.storageUsageFetchedAtISO, STORAGE_USAGE_REFRESH_INTERVAL_MS),
    refreshOpenAI: shouldRefreshByAge(state.openaiCostsFetchedAtISO, OPENAI_COSTS_REFRESH_INTERVAL_MS)
  };
}

function refreshUsageIfNeeded(options = {}) {
  const autoTriggered = Boolean(options.autoTriggered);
  if (autoTriggered && !state.autoRefreshEnabled) {
    return Promise.resolve(false);
  }
  if (state.usageTileCollapsed) {
    return Promise.resolve(false);
  }
  const {
    refreshFirestore,
    refreshCodex,
    refreshStorage,
    refreshOpenAI
  } = shouldRefreshUsage(options);
  const forceReload = Boolean(options.forceReload);

  if (!refreshFirestore && !refreshCodex && !refreshStorage && !refreshOpenAI) {
    return Promise.resolve(false);
  }
  if (!forceReload && usageRefreshInFlight) {
    return usageRefreshInFlight;
  }

  const jobs = [];
  if (refreshFirestore) jobs.push(loadUsageSummary({ forceReload }));
  if (refreshCodex) jobs.push(loadCodexUsageSummary({ forceReload }));
  if (refreshStorage) jobs.push(loadStorageUsageSummary({ forceReload }));
  if (refreshOpenAI) jobs.push(loadOpenAICostsSummary({ forceReload }));

  usageRefreshInFlight = Promise.all(jobs)
    .then(() => refreshUsageOverviewSummaryIfNeeded({ forceReload }))
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
  if (memoType === "propomemo") return "propo";
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
    state.usageOverviewAiSummary = "";
    state.usageOverviewAiSummaryModel = "";
    state.usageOverviewAiSummaryError = "";
  } catch (error) {
    state.usageSummary = null;
    state.usageError = error.message || "Failed to load usage";
    state.usageFetchedAtISO = "";
    state.usageOverviewAiSummary = "";
    state.usageOverviewAiSummaryModel = "";
    state.usageOverviewAiSummaryError = "";
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
    state.usageOverviewAiSummary = "";
    state.usageOverviewAiSummaryModel = "";
    state.usageOverviewAiSummaryError = "";
  } catch (error) {
    state.codexUsageSummary = null;
    state.codexUsageError = error.message || "Failed to load codex usage";
    state.codexUsageFetchedAtISO = "";
    state.usageOverviewAiSummary = "";
    state.usageOverviewAiSummaryModel = "";
    state.usageOverviewAiSummaryError = "";
  }
}

async function loadStorageUsageSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams();
  if (forceReload) params.set("nocache", "1");

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/storage?${params.toString()}`,
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
    state.storageUsageSummary = body;
    state.storageUsageError = "";
    state.storageUsageFetchedAtISO = new Date().toISOString();
  } catch (error) {
    state.storageUsageSummary = null;
    state.storageUsageError = error.message || "Failed to load storage usage";
    state.storageUsageFetchedAtISO = "";
  }
}

async function loadOpenAICostsSummary(options = {}) {
  const forceReload = Boolean(options.forceReload);
  const params = new URLSearchParams();
  if (forceReload) params.set("nocache", "1");

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const fetchPromise = fetch(
    `/api/usage/openai-costs?${params.toString()}`,
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
    state.openaiCostsSummary = body;
    state.openaiCostsError = "";
    state.openaiCostsFetchedAtISO = new Date().toISOString();
  } catch (error) {
    state.openaiCostsSummary = null;
    state.openaiCostsError = error.message || "Failed to load OpenAI costs";
    state.openaiCostsFetchedAtISO = "";
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
      label.className = "w-5 text-[9px] font-semibold leading-3 text-[#eef4ff]";
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
    const points = values.map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 100 - Math.max(6, Math.min(94, Number(value || 0)));
      return `${x},${y}`;
    }).join(" ");
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

      const value = Math.max(0, Math.min(100, Number(item.value || 0)));
      const radius = 18;
      const circumference = Math.PI * radius;
      const fillLength = (value / 100) * circumference;
      const label = String(item.label || "");

      gaugeWrap.innerHTML = `
        <svg viewBox="0 0 52 34" class="h-9 w-full overflow-visible">
          <path d="M8 28 A18 18 0 0 1 44 28" fill="none" stroke="${item.trackColor}" stroke-width="5" stroke-linecap="butt"></path>
          <path d="M8 28 A18 18 0 0 1 44 28" fill="none" stroke="${item.fillColor}" stroke-width="5" stroke-linecap="butt" stroke-dasharray="${fillLength} ${circumference}"></path>
          <text x="26" y="32.0" text-anchor="middle" dominant-baseline="ideographic" font-size="14" font-weight="500" fill="#f8fbff">${label}</text>
        </svg>
      `;
      wrap.appendChild(gaugeWrap);
    });
    return wrap;
  }

  function makeMiniOpenAICombinedGraph(dailyValues, currentUsd, maxUsd = 5, markerUsd = 3) {
    const wrap = document.createElement("div");
    wrap.className = "mt-0.5 w-full space-y-0.5";

    const line = document.createElement("div");
    line.className = "h-5 w-full overflow-hidden rounded-[6px] bg-[#4b5563] px-1 py-0.5";
    const points = dailyValues.map((value, index) => {
      const x = dailyValues.length <= 1 ? 0 : (index / (dailyValues.length - 1)) * 100;
      const y = 100 - Math.max(6, Math.min(94, Number(value || 0)));
      return `${x},${y}`;
    }).join(" ");
    line.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="h-full w-full"><polyline fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" points="${points}" class="text-[#ebc8d4]"></polyline></svg>`;

    const track = document.createElement("div");
    track.className = "relative h-[6px] w-full overflow-hidden rounded-full bg-[#eceef1]";
    track.title = `current ${formatUsd(currentUsd, 2)} / max ${formatUsd(maxUsd, 0)}`;

    const fill = document.createElement("span");
    fill.className = "absolute bottom-0 left-0 top-0 rounded-full bg-[#cf7896]";
    fill.style.width = `${Math.max(0, Math.min(100, (Number(currentUsd || 0) / Math.max(0.001, maxUsd)) * 100))}%`;
    track.appendChild(fill);

    if (Number.isFinite(markerUsd) && markerUsd > 0) {
      const marker = document.createElement("span");
      marker.className = "absolute top-1/2 z-10 h-[12px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b828a]";
      marker.style.left = `${Math.max(0, Math.min(100, (Number(markerUsd || 0) / Math.max(0.001, maxUsd)) * 100))}%`;
      marker.title = `marker ${formatUsd(markerUsd, 0)}`;
      track.appendChild(marker);
    }

    wrap.appendChild(line);
    wrap.appendChild(track);
    return wrap;
  }

  function makeUsageCard({ title, badgeText, badgePressure, summaryText, summaryHtml, graphEl, dblclickUrl, titleText }) {
    const card = document.createElement("div");
    card.className = "flex h-[74px] flex-col rounded-md border border-[#4b5563] bg-[#4b5563] px-2 py-1";
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
    badge.className = "inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold leading-none border bg-[#ffffff] text-[#374151]";
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
      graphSlot.className = "flex h-8 w-full min-w-0 items-center justify-center";
      graphSlot.appendChild(graphEl);
      card.appendChild(graphSlot);
    }
    card.appendChild(main);
    return card;
  }

  row.appendChild(makeUsageCard({
    title: "Firestore",
    badgeText: state.usageSummary ? `${fsPeak.toFixed(1)}%` : "-",
    badgePressure: fsPeak,
    graphEl: makeMiniSemicircleGauges(
      [
        {
          label: "R",
          value: fsSnapshot.relativePercent.read,
          fillColor: "#7fb6f6",
          trackColor: "#5f7ea3",
          title: `read vs14 ${formatPercent(fsSnapshot.relativePercent.read, 1)}`
        },
        {
          label: "W",
          value: fsSnapshot.relativePercent.write,
          fillColor: "#ffc36f",
          trackColor: "#8f7650",
          title: `write vs14 ${formatPercent(fsSnapshot.relativePercent.write, 1)}`
        },
        {
          label: "D",
          value: fsSnapshot.relativePercent.delete,
          fillColor: "#ff9bb9",
          trackColor: "#94677b",
          title: `delete vs14 ${formatPercent(fsSnapshot.relativePercent.delete, 1)}`
        }
      ]
    ),
    summaryHtml: state.usageSummary
      ? `<strong>r${formatPercent(fsSnapshot.ratePercent.read, 1)}</strong> - w${formatPercent(fsSnapshot.ratePercent.write, 1)} - d${formatPercent(fsSnapshot.ratePercent.delete, 1)}`
      : "",
    summaryText: state.usageSummary ? "" : (state.usageError ? "error" : "loading..."),
    dblclickUrl: FIREBASE_USAGE_PAGE_URL,
    titleText: "Double-click to open Firestore usage"
  }));

  row.appendChild(makeUsageCard({
    title: "Storage",
    badgeText: state.storageUsageSummary ? `${storageSnapshot.peakPercent.toFixed(1)}%` : "-",
    badgePressure: storageSnapshot.peakPercent,
    graphEl: makeMiniProgressRows(
      [
        {
          label: "S",
          value: Number(storageSnapshot.percentOfNoCost.storage || 0),
          color: "bg-[#b8efe8]",
          bg: "bg-[#5f8b87]",
          title: `storage ${formatPercent(storageSnapshot.percentOfNoCost.storage, 1)}`
        },
        {
          label: "T",
          value: Number(storageSnapshot.percentOfNoCost.download || 0),
          color: "bg-[#9fe0ff]",
          bg: "bg-[#5a88a0]",
          title: `transfer ${formatPercent(storageSnapshot.percentOfNoCost.download, 1)}`
        }
      ]
    ),
    summaryHtml: state.storageUsageSummary
      ? `sv: <strong>${formatBytes(storageSnapshot.bytes)}</strong> - tr:<strong>${formatBytes(storageSnapshot.egressBytes30d)}</strong>`
      : "",
    summaryText: state.storageUsageSummary ? "" : (state.storageUsageError ? "error" : "loading..."),
    dblclickUrl: STORAGE_USAGE_PAGE_URL,
    titleText: "Double-click to open Storage usage"
  }));

  row.appendChild(makeUsageCard({
    title: "OpenAI",
    badgeText: state.openaiCostsSummary
      ? state.openaiCostsSummary.available
        ? formatUsd(openaiSnapshot.totalUsd30d, 2)
        : "n/a"
      : "-",
    badgePressure: Math.min(100, openaiSnapshot.totalUsd30d * 10),
    graphEl: makeMiniOpenAICombinedGraph(
      (Array.isArray(state.openaiCostsSummary?.daily) ? state.openaiCostsSummary.daily.slice(-10) : [])
        .map((item) => Number(item.amountUsd || 0) * 100)
        .map((value) => Math.max(10, Math.min(100, value * 2))),
      Number(openaiSnapshot.totalUsd30d || 0),
      3.5,
      3
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
      : (state.openaiCostsError ? "error" : "loading..."),
    dblclickUrl: OPENAI_USAGE_PAGE_URL,
    titleText: "Double-click to open OpenAI usage"
  }));

  row.appendChild(makeUsageCard({
    title: "Codex",
    badgeText: state.codexUsageSummary ? `${formatPercent(codexSecondary?.usedPercent, 0)}` : "-",
    badgePressure: 100 - Number(codexSecondary?.remainingPercent || 0),
    graphEl: makeMiniProgressRows(
      [
        {
          label: "5h",
          value: Number(state.codexUsageSummary?.primaryWindow?.remainingPercent || 0),
          color: "bg-[#ffd792]",
          bg: "bg-[#826542]",
          title: `5h ${formatPercent(state.codexUsageSummary?.primaryWindow?.remainingPercent, 0)}`
        },
        {
          label: "1w",
          value: Number(codexSecondary?.remainingPercent || 0),
          color: "bg-[#baf0a7]",
          bg: "bg-[#5c8257]",
          title: `1w ${formatPercent(codexSecondary?.remainingPercent, 0)}`
        }
      ]
    ),
    summaryHtml: state.codexUsageSummary
      ? `5h:<strong>${formatPercent(state.codexUsageSummary?.primaryWindow?.remainingPercent, 0)}</strong> - 1w:<strong>${formatPercent(codexSecondary?.remainingPercent, 0)}</strong>`
      : "",
    summaryText: state.codexUsageSummary ? "" : (state.codexUsageError ? "error" : "loading..."),
    dblclickUrl: CODEX_USAGE_PAGE_URL,
    titleText: "Double-click to open Codex usage"
  }));
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
      maybeRunAutoRefresh(() => refreshUsageIfNeeded({ autoTriggered: true })).catch(() => {});
    }
  });
  usageTop.appendChild(usageLabel);
  if (state.usageTileCollapsed) {
    const collapsedSummary = document.createElement("div");
    collapsedSummary.className = "mx-2 grid min-w-0 flex-1 grid-cols-4 items-center justify-items-center gap-1 text-[11px] leading-4 text-[#e5e7eb]";

    const collapsedItems = [
      { label: "FS", text: state.usageSummary ? `${fsPeak.toFixed(1)}%` : "-", pressure: fsPeak },
      { label: "ST", text: state.storageUsageSummary ? `${storageSnapshot.peakPercent.toFixed(1)}%` : "-", pressure: storageSnapshot.peakPercent },
      {
        label: "OA",
        text: state.openaiCostsSummary
          ? state.openaiCostsSummary.available ? formatUsd(openaiSnapshot.totalUsd30d, 1) : "n/a"
          : "-",
        pressure: Math.min(100, openaiSnapshot.totalUsd30d * 10)
      },
      {
        label: "CX",
        text: state.codexUsageSummary ? `${formatPercent(codexSecondary?.usedPercent, 0)}` : "-",
        pressure: 100 - Number(codexSecondary?.remainingPercent || 0)
      }
    ];
    for (const item of collapsedItems) {
      const wrap = document.createElement("span");
      wrap.className = "inline-flex min-w-0 items-center justify-center gap-1";
      const label = document.createElement("span");
      label.className = "text-[11px] font-bold tracking-wide text-[#e5e7eb]";
      label.textContent = item.label;
      const badge = document.createElement("span");
      badge.className = "inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold leading-none border bg-[#ffffff] text-[#374151]";
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
    const storageBadge = document.createElement("span");
    storageBadge.className = [
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
      storageBadgeClass(item.storageKind)
    ].join(" ");
    storageBadge.textContent = storageBadgeText(item.storageKind);
    const metaText = document.createElement("small");
    metaText.className = "block min-w-0 truncate whitespace-nowrap text-[9px] leading-3.5 text-[#78829a]";
    metaText.textContent = `${item.projectName}`;
    const dateText = document.createElement("small");
    dateText.className = "shrink-0 whitespace-nowrap text-[9px] leading-3.5 text-[#7f8aa3]";
    dateText.textContent = formatDate(item.updatedAtISO || item.datetimeISO || item.createdAtISO);
    meta.appendChild(typeBadge);
    meta.appendChild(storageBadge);
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
  if (isReadOnlyPanel) {
    setEditorStorageKind(currentDefaultStorageKind());
  } else if (item?.storageKind) {
    setEditorStorageKind(item.storageKind);
  } else if (!state.selectedId) {
    setEditorStorageKind(options.editorStorageKind || currentDefaultStorageKind());
  }
  renderStorageControls();
  el.projectNameInput.value = item?.projectName || "";
  el.memoTypeInput.value = item?.memoType || "memo";
  el.threadTitleInput.value = item?.threadTitle || "";
  el.memoBodyInput.value = item?.memoBody || "";
  state.editorAttachments = normalizeEditorAttachments(item?.attachments);
  renderAttachmentList();
  renderStorageInfo(state.selectedId ? item : null);
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
  el.addImageBtn.disabled = isReadOnlyPanel;
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
  const autoTriggered = Boolean(options.autoTriggered);
  if (autoTriggered && !state.autoRefreshEnabled) {
    return false;
  }
  const forceReload = Boolean(options.forceReload);
  const usageJob = refreshUsageIfNeeded({ forceReload, autoTriggered });

  try {
    const selectFirst = Boolean(options.selectFirst);
    const params = new URLSearchParams();
    if (el.qInput.value.trim()) params.set("q", el.qInput.value.trim());
    if (el.projectInput.value.trim()) params.set("projectName", el.projectInput.value.trim());
    if (el.typeSelect.value) params.set("memoType", el.typeSelect.value);
    if (currentStorageFilterKind()) params.set("storageKind", currentStorageFilterKind());
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
    fillEditor(data.item, { fromCache: state.lastResponseCacheHit, editorStorageKind: data.item?.storageKind });
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
  const validationError = currentPayloadValidationError();
  if (validationError) {
    setStatus(validationError, true);
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
  const memo = currentMemoForExport();
  const body = buildShareBody(memo, format);
  const fileName = ensureFileNameExtension(buildThreadNameFileName(memo, format), format);
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
}

function currentMemoForExport() {
  const selected = state.items.find((memo) => memo.id === state.selectedId) || {};
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
    datetimeISO: selected.datetimeISO || ""
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
  const threadName = String(memo.threadTitle || memo.threadName || memo.id || "memo").trim();
  const base = threadName
    // Remove characters commonly disallowed on major filesystems.
    .replace(/[\/\\:*?"<>|]/g, "")
    // Remove ASCII control chars.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Avoid trailing dots/spaces (problematic on Windows).
    .replace(/[. ]+$/g, "")
    .trim() || "memo";
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
  const body = buildShareBody(memo, format);
  const fileName = ensureFileNameExtension(buildThreadNameFileName(memo, format), format);
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
  showSummaryTooltip({
    head: "summary (gpt-4.1-nano)",
    body: "要約中...",
    isError: false,
    followPointer: true
  });

  try {
    const res = await request("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadTitle: memo.threadTitle || "",
        memoBody: source
      })
    });
    if (reqId !== summaryRequestSeq) return;
    showSummaryTooltip({
      head: `summary (${res.model || "gpt-4.1-nano"})`,
      body: String(res.summary || "").trim() || "(empty)",
      isError: false,
      followPointer: true
    });
    setStatus("Summary ready");
  } catch (error) {
    if (reqId !== summaryRequestSeq) return;
    showSummaryTooltip({
      head: "summary error",
      body: String(error.message || error || "Failed to summarize"),
      isError: true,
      followPointer: true
    });
    setStatus(`Summary error: ${error.message || error}`, true);
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
  document.addEventListener("mousemove", rememberPointerPosition, { passive: true });
  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (target && target.closest && (target.closest("#summaryBtn") || target.closest("#summaryTooltip"))) {
      return;
    }
    hideSummaryTooltip();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideSummaryTooltip();
  });

  el.newBtn.addEventListener("click", () => {
    setBodyMode("text");
    fillEditor({
      projectName: "common",
      memoType: "memo",
      threadTitle: "",
      memoBody: "",
      storageKind: currentDefaultStorageKind(),
      attachments: [],
      deletable: false
    }, { editorStorageKind: currentDefaultStorageKind() });
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
    maybeRunAutoRefresh(() => loadMemos({ autoTriggered: true }));
  });
  el.storageFilterSelect.addEventListener("change", () => {
    state.storageFilterKind = currentStorageFilterKind();
    maybeRunAutoRefresh(() => loadMemos({ autoTriggered: true }));
  });
  el.autoRefreshIndicator.addEventListener("click", () => {
    state.autoRefreshEnabled = !state.autoRefreshEnabled;
    renderAutoRefreshIndicator();
    setStatus(
      state.autoRefreshEnabled ? "Auto refresh ON" : "Auto refresh OFF",
      false,
      "force"
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
      setStatus(`Next new memo: ${displayStorageKindLabel(currentDefaultStorageKind())}`);
      renderStorageInfo(null);
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
    updateSaveButtonState();
    setStatus(`Change on save: ${displayStorageKindLabel(currentEditingStorageKind())}`);
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
  el.attachmentInput.addEventListener("change", async (ev) => {
    try {
      await addImageFiles(ev.target.files);
    } catch (error) {
      setStatus(`Image add error: ${error.message}`, true);
    } finally {
      ev.target.value = "";
    }
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
    const imageTarget = ev.target && ev.target.closest ? ev.target.closest("img") : null;
    if (imageTarget && imageTarget.getAttribute("src")) {
      ev.preventDefault();
      showAttachmentLightbox(imageTarget.getAttribute("src"), imageTarget.getAttribute("alt") || "");
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
  el.memoPreview.addEventListener("dblclick", (ev) => {
    const hasLinkTarget = ev.target && ev.target.closest && ev.target.closest("a");
    const hasImageTarget = ev.target && ev.target.closest && ev.target.closest("img");
    if (hasLinkTarget || hasImageTarget || getBodyMode() !== "preview" || isReadOnlyPanelSelected()) return;
    setBodyMode("text");
    updateBodyMode();
    el.memoBodyInput.focus();
  });
  const dropTargets = [el.memoBodyInput, el.memoPreview, el.attachmentList].filter(Boolean);
  dropTargets.forEach((node) => {
    node.addEventListener("dragenter", (ev) => {
      if (!canAcceptEditorImageInput()) return;
      if (filesFromDataTransfer(ev.dataTransfer).length === 0) return;
      ev.preventDefault();
      setDropHint(true);
    });
    node.addEventListener("dragover", (ev) => {
      if (!canAcceptEditorImageInput()) return;
      if (filesFromDataTransfer(ev.dataTransfer).length === 0) return;
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
      if (files.length === 0) return;
      ev.preventDefault();
      setDropHint(false);
      try {
        await addImageFiles(files);
        setStatus(`Added ${files.length} image${files.length > 1 ? "s" : ""} by drop`);
      } catch (error) {
        setStatus(`Image drop error: ${error.message}`, true);
      }
    });
  });
  document.addEventListener("drop", () => setDropHint(false));
  document.addEventListener("dragend", () => setDropHint(false));
  document.addEventListener("paste", async (ev) => {
    if (!canAcceptEditorImageInput()) return;
    const active = document.activeElement;
    const editing = active === el.memoBodyInput || active === el.memoPreview || active === el.threadTitleInput;
    if (!editing) return;
    const files = filesFromDataTransfer(ev.clipboardData);
    if (files.length === 0) return;
    ev.preventDefault();
    try {
      await addImageFiles(files);
      setStatus(`Added ${files.length} image${files.length > 1 ? "s" : ""} from paste`);
    } catch (error) {
      setStatus(`Image paste error: ${error.message}`, true);
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
  el.summaryBtn.addEventListener("click", summarizeMemoAtPointer);
}

initEvents();
fillEditor(null);
setBodyMode("preview");
updateBodyMode();
renderAutoRefreshIndicator();

async function initApp() {
  try {
    await loadRuntimeConfig();
    renderStorageInfo(null);
    await loadMemos();
  } catch (error) {
    setStatus(`Init error: ${error.message}`, true);
  }
}

initApp();

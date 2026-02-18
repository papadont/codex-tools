const state = {
  items: [],
  selectedId: null,
  hasInitialAutoSelection: false,
  lastResponseCacheHit: false,
  selectedCacheHit: false,
  showOnlyDeletable: false
};

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
  bodyModeSelect: document.getElementById("bodyModeSelect"),
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

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function updateBodyMode() {
  const preview = el.bodyModeSelect.value === "preview";
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

function syncDeleteButtonLabel() {
  el.deleteBtn.textContent = state.showOnlyDeletable ? "ALL" : "Delete";
}

function renderList() {
  el.memoList.innerHTML = "";
  const items = sortMemosForList(listItemsForView());

  for (const item of items) {
    const li = document.createElement("li");
    const isActive = item.id === state.selectedId;
    const isPinned = Boolean(item.pinned);
    const isDeletable = Boolean(item.deletable);
    const pinBlocked = !isPinned && isDeletable;
    const delBlocked = !isDeletable && isPinned;
    li.className = [
      "relative",
      "cursor-pointer",
      "rounded-lg",
      "border",
      "px-2.5",
      "py-2",
      "transition-colors",
      "hover:bg-[#e7e1d7]",
      isActive
        ? "border-[#ddd5c8] bg-[#fcfbf8]"
        : isPinned
          ? "border-[#9aabc9] bg-[#f9f6f0]"
          : "border-[#e5ddd2] bg-[#f9f6f0]"
    ].join(" ");

    const topRow = document.createElement("div");
    topRow.className = "flex items-center gap-1";

    const title = document.createElement("strong");
    title.className = [
      "block",
      "text-[13px]",
      "leading-4",
      item.memoType === "keep" ? "text-[#5f8a5f]" : "text-[#4f5f7e]"
    ].join(" ");
    title.textContent = item.threadTitle || "(no title)";

    topRow.appendChild(title);

    const meta = document.createElement("small");
    meta.className = "mt-0.5 block truncate whitespace-nowrap pr-8 text-[9px] leading-3.5 text-[#78829a]";
    meta.textContent = `${item.memoType} | ${item.projectName} | ${formatDate(item.datetimeISO || item.createdAtISO)}`;

    li.appendChild(topRow);
    li.appendChild(meta);

    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className = [
      "absolute",
      "right-1",
      "top-1/2",
      "-translate-y-[12px]",
      "h-3",
      "w-3",
      "rounded",
      "border",
      isPinned
        ? "border-[#6e84ad] bg-[#6e84ad]"
        : "border-[#cfc6b7] bg-[#f4f1eb] hover:bg-[#e7e1d7]",
      pinBlocked ? "opacity-40 cursor-not-allowed" : ""
    ].join(" ");
    pinBtn.textContent = "";
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
    li.appendChild(pinBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = [
      "absolute",
      "right-1",
      "top-1/2",
      "translate-y-[5px]",
      "h-3",
      "w-3",
      "flex",
      "items-center",
      "justify-center",
      "rounded",
      "leading-none",
      "border",
      isDeletable
        ? "border-[#cf7896] bg-[#cf7896] text-[#fff7fb]"
        : "border-[#cfc6b7] bg-[#f4f1eb] text-[#8e97ab] hover:bg-[#e7e1d7]",
      delBlocked ? "opacity-40 cursor-not-allowed" : ""
    ].join(" ");
    delBtn.innerHTML = [
      '<svg viewBox="0 0 12 12" aria-hidden="true" class="h-full w-full stroke-current">',
      '<line x1="1.5" y1="1.5" x2="10.5" y2="10.5" stroke-width="1.4" stroke-linecap="round"></line>',
      '<line x1="10.5" y1="1.5" x2="1.5" y2="10.5" stroke-width="1.4" stroke-linecap="round"></line>',
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
    li.appendChild(delBtn);

    li.addEventListener("click", () => loadMemo(item.id));
    el.memoList.appendChild(li);
  }
}

function fillEditor(item, options = {}) {
  state.selectedId = item && item.id ? item.id : null;
  state.selectedCacheHit = Boolean(options.fromCache);
  el.projectNameInput.value = item?.projectName || "";
  el.memoTypeInput.value = item?.memoType || "memo";
  el.threadTitleInput.value = item?.threadTitle || "";
  el.memoBodyInput.value = item?.memoBody || "";
  el.dateText.textContent = renderDateWithCacheIndicator(
    item?.updatedAtISO || item?.createdAtISO || item?.datetimeISO
  );
  el.deleteBtn.disabled = false;
  syncDeleteButtonLabel();
  el.deleteBtn.title = state.showOnlyDeletable
    ? "ALL: delete all deletable docs (Shift: filter off)"
    : "ALL: delete all deletable docs (Shift: filter on)";
  updateBodyMode();
  renderList();
  setStatus("");
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
  try {
    const forceReload = Boolean(options.forceReload);
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
    const visibleItems = sortMemosForList(listItemsForView());
    if (selectFirst && visibleItems.length > 0) {
      fillEditor(visibleItems[0], { fromCache: listFromCache });
      state.hasInitialAutoSelection = true;
      return;
    }
    if (!state.selectedId && !state.hasInitialAutoSelection && visibleItems.length > 0) {
      const sorted = visibleItems;
      fillEditor(sorted[0], { fromCache: listFromCache });
      state.hasInitialAutoSelection = true;
      return;
    }
    if (state.selectedId && !state.items.some((memo) => memo.id === state.selectedId)) {
      state.selectedId = null;
    }
    renderList();
  } catch (error) {
    setStatus(`Load error: ${error.message}`, true);
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
  if (!selected.deletable) {
    const promote = window.confirm("DEL is off. Turn DEL on and delete this selected memo?");
    if (!promote) {
      setStatus("Delete cancelled", true);
      return;
    }
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
  const ok = window.confirm(`Delete selected memo? (${selected.id})`);
  if (!ok) {
    setStatus("Delete cancelled", true);
    return;
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
    renderList();
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

async function shareMemo() {
  const format = el.downloadFormatSelect.value || "txt";
  const memo = currentMemoForExport();
  const body = buildExportBody(memo, format);
  const fileName = buildExportFileName(memo, format);
  const typeMap = {
    txt: "text/plain;charset=utf-8",
    md: "text/markdown;charset=utf-8",
    json: "application/json;charset=utf-8"
  };
  try {
    if (navigator.share) {
      if (typeof File !== "undefined" && navigator.canShare) {
        const file = new File([body], fileName, { type: typeMap[format] || typeMap.txt });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: memo.threadTitle || "codex-memo",
            files: [file]
          });
          setStatus(`Shared ${format.toUpperCase()} file`);
          return;
        }
      }
      await navigator.share({
        title: memo.threadTitle || "codex-memo",
        text: body
      });
      setStatus(`Shared as ${format.toUpperCase()} text`);
      return;
    }
    await navigator.clipboard.writeText(body);
    setStatus(`Web Share unavailable. Copied ${format.toUpperCase()} text`);
  } catch (error) {
    setStatus(`Share error: ${error.message}`, true);
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
    fillEditor({
      projectName: el.projectInput.value.trim(),
      memoType: "memo",
      threadTitle: "",
      memoBody: "",
      deletable: false
    });
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
  el.bodyModeSelect.addEventListener("change", updateBodyMode);
  el.memoBodyInput.addEventListener("input", () => {
    if (el.bodyModeSelect.value === "preview") {
      renderMarkdownPreview();
    }
  });

  el.saveBtn.addEventListener("click", saveMemo);
  el.deleteBtn.addEventListener("click", deleteMemo);
  el.downloadBtn.addEventListener("click", () => downloadMemo(el.downloadFormatSelect.value || "txt"));
  el.copyBodyBtn.addEventListener("click", copyBodyText);
  el.shareBtn.addEventListener("click", shareMemo);
}

initEvents();
fillEditor(null);
updateBodyMode();
loadMemos();

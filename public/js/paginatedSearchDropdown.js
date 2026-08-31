/**
 * Generic searchable + paginated dropdown controller.
 *
 * loadPage must return:
 * { items: any[], nextCursor?: string|null, hasMore?: boolean }
 */
export function createPaginatedSearchDropdown(config) {
  const {
    dropdownEl,
    searchInputEl,
    optionsEl,
    loadPage,
    getItemKey,
    getItemLabel,
    getSelectedKey = () => "",
    onSelect = async () => {},
    onError = () => {},
    onStateChange = () => {},
    limit = 25,
    debounceMs = 250,
    scrollThresholdPx = 24,
    emptyText = "No results found",
    loadingText = "Loading...",
    loadMoreText = "Load more",
    loadingMoreText = "Loading more...",
    closeOnSelect = true,
  } = config || {};

  if (!dropdownEl || !searchInputEl || !optionsEl) {
    throw new Error("createPaginatedSearchDropdown requires dropdownEl, searchInputEl, and optionsEl");
  }
  if (typeof loadPage !== "function") {
    throw new Error("createPaginatedSearchDropdown requires loadPage callback");
  }
  if (typeof getItemKey !== "function" || typeof getItemLabel !== "function") {
    throw new Error("createPaginatedSearchDropdown requires getItemKey and getItemLabel callbacks");
  }

  let items = [];
  const itemMap = new Map();
  let searchTerm = "";
  let nextCursor = null;
  let hasMore = false;
  let loading = false;
  let requestId = 0;
  let searchDebounce = null;

  function emitState() {
    onStateChange({
      loading,
      itemCount: items.length,
      hasMore,
      searchTerm,
      nextCursor,
      isOpen: isOpen(),
    });
  }

  function normalizeCursor(value) {
    const cursor = String(value || "").trim();
    return cursor || null;
  }

  function setLoading(value) {
    loading = Boolean(value);
    emitState();
  }

  function isOpen() {
    return !dropdownEl.classList.contains("hidden");
  }

  function clearItems() {
    items = [];
    itemMap.clear();
  }

  function appendItems(nextItems) {
    if (!Array.isArray(nextItems)) return;

    for (const item of nextItems) {
      if (!item || typeof item !== "object") continue;
      const key = String(getItemKey(item) || "").trim();
      if (!key || itemMap.has(key)) continue;
      itemMap.set(key, item);
      items.push(item);
    }
  }

  function render() {
    optionsEl.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "branch-option disabled";
      empty.textContent = loading ? loadingText : emptyText;
      optionsEl.appendChild(empty);
      return;
    }

    const selectedKey = String(getSelectedKey() || "").trim();

    for (const item of items) {
      const key = String(getItemKey(item) || "").trim();
      if (!key) continue;

      const option = document.createElement("div");
      option.className = `branch-option${selectedKey === key ? " selected" : ""}`;
      option.dataset.optionKey = key;
      option.textContent = String(getItemLabel(item) || "");
      optionsEl.appendChild(option);
    }

    if (hasMore || loading) {
      const more = document.createElement("div");
      more.className = `branch-option${loading ? " disabled" : ""}`;
      more.dataset.loadMore = "1";
      more.textContent = loading ? loadingMoreText : loadMoreText;
      optionsEl.appendChild(more);
    }
  }

  async function load({ reset = false } = {}) {
    if (loading) return;
    if (!reset && (!hasMore || !nextCursor)) return;

    const currentRequestId = ++requestId;

    if (reset) {
      nextCursor = null;
      hasMore = false;
      clearItems();
      render();
      emitState();
    }

    setLoading(true);
    render();

    try {
      const response = await loadPage({
        search: searchTerm,
        cursor: reset ? "" : nextCursor,
        limit,
      });

      if (currentRequestId !== requestId) return;

      appendItems(Array.isArray(response?.items) ? response.items : []);

      const normalizedNext = normalizeCursor(response?.nextCursor);
      hasMore = Boolean(response?.hasMore && normalizedNext);
      nextCursor = hasMore ? normalizedNext : null;
    } catch (error) {
      if (currentRequestId !== requestId) return;
      onError(error);
    } finally {
      if (currentRequestId === requestId) {
        setLoading(false);
        render();
      }
    }
  }

  async function ensureLoaded({ reset = false } = {}) {
    if (!reset && (items.length > 0 || loading)) return;
    await load({ reset: true });
  }

  function scheduleSearchLoad() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      void load({ reset: true });
    }, debounceMs);
  }

  function handleSearchInput() {
    searchTerm = String(searchInputEl.value || "").trim();
    scheduleSearchLoad();
  }

  function handleSearchKeydown(event) {
    if (event.key === "Escape") close();
  }

  function handleOptionsScroll() {
    if (loading || !hasMore || !nextCursor) return;

    const remaining = optionsEl.scrollHeight - optionsEl.scrollTop - optionsEl.clientHeight;
    if (remaining <= scrollThresholdPx) {
      void load({ reset: false });
    }
  }

  async function handleOptionsClick(event) {
    const option = event.target.closest(".branch-option");
    if (!option) return;

    if (option.dataset.loadMore === "1") {
      if (!loading && hasMore && nextCursor) {
        await load({ reset: false });
      }
      return;
    }

    if (option.classList.contains("disabled")) return;

    const key = String(option.dataset.optionKey || "").trim();
    if (!key) return;

    const item = itemMap.get(key);
    if (!item) return;

    try {
      await onSelect(item);
      render();
      if (closeOnSelect) close();
    } catch (error) {
      onError(error);
    }
  }

  function open() {
    dropdownEl.classList.remove("hidden");
    emitState();
  }

  function close() {
    dropdownEl.classList.add("hidden");
    emitState();
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function focusSearch() {
    searchInputEl.focus();
  }

  function clearSearch() {
    searchTerm = "";
    searchInputEl.value = "";
  }

  function getItemCount() {
    return items.length;
  }

  function isLoading() {
    return loading;
  }

  function destroy() {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchInputEl.removeEventListener("input", handleSearchInput);
    searchInputEl.removeEventListener("keydown", handleSearchKeydown);
    optionsEl.removeEventListener("scroll", handleOptionsScroll);
    optionsEl.removeEventListener("click", handleOptionsClick);
  }

  searchInputEl.addEventListener("input", handleSearchInput);
  searchInputEl.addEventListener("keydown", handleSearchKeydown);
  optionsEl.addEventListener("scroll", handleOptionsScroll);
  optionsEl.addEventListener("click", handleOptionsClick);

  emitState();

  return {
    open,
    close,
    toggle,
    isOpen,
    focusSearch,
    clearSearch,
    ensureLoaded,
    load,
    render,
    getItemCount,
    isLoading,
    destroy,
  };
}

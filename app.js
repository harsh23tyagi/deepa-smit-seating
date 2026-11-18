(function () {
  "use strict";

  const data = window.WEDDING_DATA;
  if (!data || !Array.isArray(data.tables)) return;

  // Build flat guest index
  const ALL_GUESTS = [];
  data.tables.forEach((table) => {
    table.guests.forEach((name, idx) => {
      ALL_GUESTS.push({
        name,
        tableId: table.id,
        tableLabel: table.label,
        seatIndex: idx,
        seatNumber: idx + 1
      });
    });
  });

  // DOM Elements
  const coupleTitleEl = document.getElementById("couple-title");
  const coupleSubtitleEl = document.getElementById("couple-subtitle");
  const venueStatsEl = document.getElementById("venue-stats");

  const searchInput = document.getElementById("guest-search");
  const clearSearchBtn = document.getElementById("clear-search");
  const searchResultsEl = document.getElementById("search-results");

  const btnFloorView = document.getElementById("btn-floor-view");
  const btnListView = document.getElementById("btn-list-view");
  const floorViewEl = document.getElementById("floor-view");
  const listViewEl = document.getElementById("list-view");

  const selectionBanner = document.getElementById("selection-banner");
  const selectionTableBadge = document.getElementById("selection-table-badge");
  const selectionTitle = document.getElementById("selection-title");
  const selectionSubtitle = document.getElementById("selection-subtitle");
  const btnOpenTableDetails = document.getElementById("btn-open-table-details");
  const btnResetView = document.getElementById("btn-reset-view");

  const floorViewport = document.getElementById("floor-viewport");
  const floorCanvas = document.getElementById("floor-canvas");
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const zoomFitBtn = document.getElementById("zoom-fit");

  const listModeAlphaBtn = document.getElementById("list-mode-alpha");
  const listModeTableBtn = document.getElementById("list-mode-table");
  const listCountEl = document.getElementById("list-count");
  const listContainerEl = document.getElementById("list-container");

  const tableModal = document.getElementById("table-modal");
  const closeModalBtn = document.getElementById("close-modal");
  const modalTableNote = document.getElementById("modal-table-note");
  const modalTableTitle = document.getElementById("modal-table-title");
  const modalRoundPreview = document.getElementById("modal-round-preview");
  const modalGuestCount = document.getElementById("modal-guest-count");
  const modalGuestList = document.getElementById("modal-guest-list");
  const btnLocateTableOnMap = document.getElementById("btn-locate-table-on-map");

  // State
  let currentView = "floor"; // "floor" | "list"
  let listMode = "alpha"; // "alpha" | "table"
  let focusedTableId = null;
  let highlightedGuest = null; // { name, tableId, seatIndex }
  let modalTableId = null;
  let dropdownIndex = -1;

  // Camera transform state for floor plan
  const cam = {
    x: 0,
    y: 0,
    scale: 1,
    minScale: 0.25,
    maxScale: 2.6
  };

  // Initialize header stats
  coupleTitleEl.textContent = data.couple;
  coupleSubtitleEl.textContent = data.subtitle;
  venueStatsEl.textContent = `${data.tables.length} Tables \u2022 ${ALL_GUESTS.length} Guests`;

  // ---------------- Floor Plan Rendering ----------------
  function renderFloorTables() {
    floorCanvas.innerHTML = "";
    floorCanvas.style.width = `${data.canvas.width}px`;
    floorCanvas.style.height = `${data.canvas.height}px`;

    if (focusedTableId !== null) {
      floorCanvas.classList.add("has-focus");
    } else {
      floorCanvas.classList.remove("has-focus");
    }

    data.tables.forEach((table) => {
      const tableEl = document.createElement("div");
      tableEl.className = "round-table";
      if (table.isFeatured) tableEl.classList.add("featured");
      if (focusedTableId === table.id) tableEl.classList.add("focused");
      tableEl.style.left = `${table.x}px`;
      tableEl.style.top = `${table.y}px`;
      tableEl.dataset.tableId = String(table.id);
      tableEl.setAttribute("role", "button");
      tableEl.setAttribute("tabindex", "0");
      tableEl.setAttribute("aria-label", `${table.label}, ${table.guests.length} guests. Tap to view.`);

      // Center round table surface
      const surface = document.createElement("div");
      surface.className = "table-surface";
      surface.innerHTML = `
        <span class="table-num">${escapeHtml(table.label)}</span>
        <span class="table-count">${table.guests.length} Guests</span>
        ${table.note ? `<span class="table-featured-tag">${escapeHtml(table.note)}</span>` : ""}
      `;
      tableEl.appendChild(surface);

      // Radial seats around the table
      const total = table.guests.length;
      const center = 105; // Half of 210px .round-table
      const seatRadius = 78;

      table.guests.forEach((guestName, idx) => {
        const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
        const sx = center + Math.cos(angle) * seatRadius;
        const sy = center + Math.sin(angle) * seatRadius;

        const isHighlighted =
          highlightedGuest &&
          highlightedGuest.tableId === table.id &&
          highlightedGuest.seatIndex === idx;

        const seatEl = document.createElement("div");
        seatEl.className = "seat-node" + (isHighlighted ? " highlighted" : "");
        seatEl.style.left = `${sx}px`;
        seatEl.style.top = `${sy}px`;
        seatEl.textContent = String(idx + 1);
        seatEl.title = `${guestName} (Seat ${idx + 1})`;

        if (isHighlighted) {
          const callout = document.createElement("div");
          callout.className = "seat-callout";
          callout.textContent = `${guestName} \u2022 ${table.label}`;
          seatEl.appendChild(callout);
        }

        tableEl.appendChild(seatEl);
      });

      // Open table modal on tap/click (only if not dragged)
      tableEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTableModal(table.id, null);
        }
      });

      floorCanvas.appendChild(tableEl);
    });
  }

  // ---------------- Camera / Pan & Zoom ----------------
  function applyTransform(animate = false) {
    if (animate) {
      floorCanvas.classList.add("animate-transform");
    } else {
      floorCanvas.classList.remove("animate-transform");
    }
    floorCanvas.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.scale})`;
  }

  function fitToScreen(animate = true) {
    const rect = floorViewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const pad = 28;
    const scaleX = (rect.width - pad * 2) / data.canvas.width;
    const scaleY = (rect.height - pad * 2) / data.canvas.height;
    const fitScale = Math.min(scaleX, scaleY, 1.05);

    cam.scale = Math.max(cam.minScale, fitScale);
    cam.x = (rect.width - data.canvas.width * cam.scale) / 2;
    cam.y = (rect.height - data.canvas.height * cam.scale) / 2;
    applyTransform(animate);
  }

  function zoomToTable(tableId, animate = true) {
    const table = data.tables.find((t) => t.id === tableId);
    if (!table) return;

    const rect = floorViewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const targetScale = rect.width < 640 ? 1.35 : 1.45;
    cam.scale = Math.min(cam.maxScale, Math.max(cam.minScale, targetScale));
    cam.x = rect.width / 2 - table.x * cam.scale;
    cam.y = rect.height / 2 - table.y * cam.scale;
    applyTransform(animate);
  }

  function zoomBy(factor, centerX, centerY) {
    const rect = floorViewport.getBoundingClientRect();
    const cx = centerX !== undefined ? centerX : rect.width / 2;
    const cy = centerY !== undefined ? centerY : rect.height / 2;

    const nextScale = Math.min(cam.maxScale, Math.max(cam.minScale, cam.scale * factor));
    const ratio = nextScale / cam.scale;

    cam.x = cx - (cx - cam.x) * ratio;
    cam.y = cy - (cy - cam.y) * ratio;
    cam.scale = nextScale;
    applyTransform(false);
  }

  // Pointer & Pinch Gestures on Floor Viewport
  const activePointers = new Map();
  let dragStart = null;
  let pinchStartDist = null;
  let pinchStartScale = 1;
  let didMove = false;

  floorViewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".map-controls")) return;
    floorViewport.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    didMove = false;

    if (activePointers.size === 1) {
      dragStart = {
        x: e.clientX,
        y: e.clientY,
        camX: cam.x,
        camY: cam.y
      };
    } else if (activePointers.size === 2) {
      const pts = Array.from(activePointers.values());
      pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchStartScale = cam.scale;
      dragStart = null;
    }
  });

  floorViewport.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 1 && dragStart) {
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (Math.hypot(dx, dy) > 5) didMove = true;
      cam.x = dragStart.camX + dx;
      cam.y = dragStart.camY + dy;
      applyTransform(false);
    } else if (activePointers.size === 2 && pinchStartDist) {
      didMove = true;
      const pts = Array.from(activePointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const rect = floorViewport.getBoundingClientRect();
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;

      const targetScale = Math.min(cam.maxScale, Math.max(cam.minScale, pinchStartScale * (dist / pinchStartDist)));
      const ratio = targetScale / cam.scale;
      cam.x = midX - (midX - cam.x) * ratio;
      cam.y = midY - (midY - cam.y) * ratio;
      cam.scale = targetScale;
      applyTransform(false);
    }
  });

  function handlePointerEnd(e) {
    const wasTap = !didMove && activePointers.size === 1;
    activePointers.delete(e.pointerId);

    if (activePointers.size === 1) {
      const remaining = Array.from(activePointers.values())[0];
      dragStart = {
        x: remaining.x,
        y: remaining.y,
        camX: cam.x,
        camY: cam.y
      };
      pinchStartDist = null;
    } else if (activePointers.size === 0) {
      dragStart = null;
      pinchStartDist = null;
    }

    if (wasTap) {
      const tableEl = e.target.closest(".round-table");
      if (tableEl) {
        const tableId = Number(tableEl.dataset.tableId);
        const guestIdx =
          highlightedGuest && highlightedGuest.tableId === tableId
            ? highlightedGuest.seatIndex
            : null;
        openTableModal(tableId, guestIdx);
      }
    }
  }

  floorViewport.addEventListener("pointerup", handlePointerEnd);
  floorViewport.addEventListener("pointercancel", handlePointerEnd);

  floorViewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = floorViewport.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      zoomBy(factor, cx, cy);
    },
    { passive: false }
  );

  zoomInBtn.addEventListener("click", () => zoomBy(1.25));
  zoomOutBtn.addEventListener("click", () => zoomBy(0.8));
  zoomFitBtn.addEventListener("click", () => resetFocus());

  // ---------------- Selection & Highlighting ----------------
  function selectGuest(guest) {
    focusedTableId = guest.tableId;
    highlightedGuest = {
      name: guest.name,
      tableId: guest.tableId,
      seatIndex: guest.seatIndex
    };

    const table = data.tables.find((t) => t.id === guest.tableId);
    selectionTableBadge.textContent = guest.tableLabel;
    selectionTitle.textContent = guest.name;
    selectionSubtitle.textContent = `Seat ${guest.seatNumber} \u2022 ${table ? table.guests.length : ""} guests at this table`;
    selectionBanner.classList.remove("hidden");

    switchView("floor");
    renderFloorTables();
    // Wait a frame so floor-view is visible and measured
    requestAnimationFrame(() => {
      zoomToTable(guest.tableId, true);
    });
  }

  function resetFocus() {
    focusedTableId = null;
    highlightedGuest = null;
    selectionBanner.classList.add("hidden");
    renderFloorTables();
    fitToScreen(true);
  }

  btnResetView.addEventListener("click", resetFocus);

  btnOpenTableDetails.addEventListener("click", () => {
    if (focusedTableId !== null) {
      const seatIdx = highlightedGuest ? highlightedGuest.seatIndex : null;
      openTableModal(focusedTableId, seatIdx);
    }
  });

  // ---------------- Search & Autocomplete ----------------
  function getMatchingGuests(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const starts = [];
    const contains = [];

    ALL_GUESTS.forEach((g) => {
      const lower = g.name.toLowerCase();
      if (lower.startsWith(q)) {
        starts.push(g);
      } else if (lower.includes(q)) {
        contains.push(g);
      }
    });

    return starts.concat(contains);
  }

  function renderDropdown(query) {
    const q = query.trim();
    if (!q) {
      searchResultsEl.classList.add("hidden");
      searchResultsEl.innerHTML = "";
      dropdownIndex = -1;
      return;
    }

    const matches = getMatchingGuests(q);
    dropdownIndex = -1;

    if (matches.length === 0) {
      searchResultsEl.innerHTML = `<li class="search-empty">No guest found matching "${escapeHtml(q)}"</li>`;
      searchResultsEl.classList.remove("hidden");
      return;
    }

    searchResultsEl.innerHTML = matches
      .slice(0, 12)
      .map((g, i) => {
        const highlightedName = highlightMatch(g.name, q);
        return `
          <li class="search-item" role="option" data-index="${i}">
            <span class="search-item-name">${highlightedName}</span>
            <span class="search-item-meta">${escapeHtml(g.tableLabel)} &bull; Seat ${g.seatNumber}</span>
          </li>
        `;
      })
      .join("");

    searchResultsEl.querySelectorAll(".search-item").forEach((item, idx) => {
      item.addEventListener("click", () => {
        const guest = matches[idx];
        searchInput.value = guest.name;
        clearSearchBtn.classList.remove("hidden");
        searchResultsEl.classList.add("hidden");
        selectGuest(guest);
        if (currentView === "list") renderListView();
      });
    });

    searchResultsEl.classList.remove("hidden");
  }

  searchInput.addEventListener("input", () => {
    const val = searchInput.value;
    if (val.trim()) {
      clearSearchBtn.classList.remove("hidden");
    } else {
      clearSearchBtn.classList.add("hidden");
    }
    renderDropdown(val);
    if (currentView === "list") {
      renderListView();
    }
  });

  searchInput.addEventListener("focus", () => {
    if (searchInput.value.trim()) {
      renderDropdown(searchInput.value);
    }
  });

  searchInput.addEventListener("keydown", (e) => {
    const items = searchResultsEl.querySelectorAll(".search-item");
    if (!items.length || searchResultsEl.classList.contains("hidden")) {
      if (e.key === "Enter") {
        const matches = getMatchingGuests(searchInput.value);
        if (matches.length > 0) {
          e.preventDefault();
          searchInput.value = matches[0].name;
          searchResultsEl.classList.add("hidden");
          selectGuest(matches[0]);
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      dropdownIndex = (dropdownIndex + 1) % items.length;
      updateDropdownActive(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      dropdownIndex = (dropdownIndex - 1 + items.length) % items.length;
      updateDropdownActive(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const targetIdx = dropdownIndex >= 0 ? dropdownIndex : 0;
      items[targetIdx].click();
    } else if (e.key === "Escape") {
      searchResultsEl.classList.add("hidden");
    }
  });

  function updateDropdownActive(items) {
    items.forEach((el, i) => {
      el.classList.toggle("active", i === dropdownIndex);
    });
    if (items[dropdownIndex]) {
      items[dropdownIndex].scrollIntoView({ block: "nearest" });
    }
  }

  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearSearchBtn.classList.add("hidden");
    searchResultsEl.classList.add("hidden");
    if (currentView === "list") renderListView();
    searchInput.focus();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrapper")) {
      searchResultsEl.classList.add("hidden");
    }
  });

  // ---------------- View Switcher ----------------
  function switchView(view) {
    currentView = view;
    if (view === "floor") {
      btnFloorView.classList.add("active");
      btnFloorView.setAttribute("aria-selected", "true");
      btnListView.classList.remove("active");
      btnListView.setAttribute("aria-selected", "false");
      floorViewEl.classList.remove("hidden");
      listViewEl.classList.add("hidden");
    } else {
      btnListView.classList.add("active");
      btnListView.setAttribute("aria-selected", "true");
      btnFloorView.classList.remove("active");
      btnFloorView.setAttribute("aria-selected", "false");
      listViewEl.classList.remove("hidden");
      floorViewEl.classList.add("hidden");
      renderListView();
    }
  }

  btnFloorView.addEventListener("click", () => {
    switchView("floor");
    requestAnimationFrame(() => {
      if (focusedTableId !== null) {
        zoomToTable(focusedTableId, false);
      } else {
        fitToScreen(false);
      }
    });
  });

  btnListView.addEventListener("click", () => switchView("list"));

  // ---------------- List View Rendering ----------------
  listModeAlphaBtn.addEventListener("click", () => {
    listMode = "alpha";
    listModeAlphaBtn.classList.add("active");
    listModeTableBtn.classList.remove("active");
    renderListView();
  });

  listModeTableBtn.addEventListener("click", () => {
    listMode = "table";
    listModeTableBtn.classList.add("active");
    listModeAlphaBtn.classList.remove("active");
    renderListView();
  });

  function renderListView() {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q
      ? ALL_GUESTS.filter((g) => g.name.toLowerCase().includes(q) || g.tableLabel.toLowerCase().includes(q))
      : ALL_GUESTS;

    listCountEl.textContent = `${filtered.length} ${filtered.length === 1 ? "guest" : "guests"}`;
    listContainerEl.innerHTML = "";

    if (filtered.length === 0) {
      listContainerEl.innerHTML = `<p class="search-empty">No guests match "${escapeHtml(searchInput.value.trim())}".</p>`;
      return;
    }

    if (listMode === "alpha") {
      const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      const groups = new Map();
      sorted.forEach((g) => {
        const letter = g.name.charAt(0).toUpperCase();
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(g);
      });

      groups.forEach((guests, letter) => {
        const groupEl = document.createElement("div");
        groupEl.className = "alpha-group";
        groupEl.innerHTML = `<h3 class="alpha-heading">${escapeHtml(letter)}</h3>`;

        const grid = document.createElement("div");
        grid.className = "guest-grid";

        guests.forEach((g) => {
          const row = document.createElement("div");
          row.className = "guest-row";
          row.setAttribute("role", "button");
          row.setAttribute("tabindex", "0");
          row.innerHTML = `
            <span class="guest-row-name">${highlightMatch(g.name, q)}</span>
            <span class="guest-row-action">${escapeHtml(g.tableLabel)} &rarr;</span>
          `;
          row.addEventListener("click", () => selectGuest(g));
          row.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectGuest(g);
            }
          });
          grid.appendChild(row);
        });

        groupEl.appendChild(grid);
        listContainerEl.appendChild(groupEl);
      });
    } else {
      const cardsGrid = document.createElement("div");
      cardsGrid.className = "table-cards-grid";

      data.tables.forEach((table) => {
        const matchingInTable = table.guests
          .map((name, idx) => ({
            name,
            tableId: table.id,
            tableLabel: table.label,
            seatIndex: idx,
            seatNumber: idx + 1
          }))
          .filter((g) => !q || g.name.toLowerCase().includes(q) || g.tableLabel.toLowerCase().includes(q));

        if (matchingInTable.length === 0) return;

        const card = document.createElement("div");
        card.className = "table-list-card";
        card.innerHTML = `
          <div class="table-list-card-header">
            <h3>${escapeHtml(table.label)}</h3>
            <button type="button" class="btn-ghost" data-table-map="${table.id}">View Table</button>
          </div>
        `;

        card.querySelector("[data-table-map]").addEventListener("click", () => {
          focusedTableId = table.id;
          highlightedGuest = null;
          selectionBanner.classList.add("hidden");
          switchView("floor");
          renderFloorTables();
          requestAnimationFrame(() => zoomToTable(table.id, true));
        });

        const ul = document.createElement("ul");
        ul.className = "table-list-names";

        matchingInTable.forEach((g) => {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.innerHTML = `
            <span>${highlightMatch(g.name, q)}</span>
            <span class="seat-idx">Seat ${g.seatNumber}</span>
          `;
          btn.addEventListener("click", () => selectGuest(g));
          li.appendChild(btn);
          ul.appendChild(li);
        });

        card.appendChild(ul);
        cardsGrid.appendChild(card);
      });

      listContainerEl.appendChild(cardsGrid);
    }
  }

  // ---------------- Table Detail Modal ----------------
  function openTableModal(tableId, activeSeatIdx = null) {
    const table = data.tables.find((t) => t.id === tableId);
    if (!table) return;

    modalTableId = tableId;
    modalTableNote.textContent = table.note || "Reception Seating";
    modalTableTitle.textContent = table.label;
    modalGuestCount.textContent = `(${table.guests.length})`;

    renderModalPreview(table, activeSeatIdx);
    tableModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function renderModalPreview(table, activeSeatIdx) {
    modalRoundPreview.innerHTML = `<div class="preview-table-circle">${escapeHtml(table.label)}</div>`;
    modalGuestList.innerHTML = "";

    const total = table.guests.length;
    const center = 125; // Half of 250px .modal-round-preview
    const radius = 94;

    table.guests.forEach((guestName, idx) => {
      const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
      const sx = center + Math.cos(angle) * radius;
      const sy = center + Math.sin(angle) * radius;
      const isActive = activeSeatIdx === idx;

      const seatBtn = document.createElement("div");
      seatBtn.className = "preview-seat" + (isActive ? " active" : "");
      seatBtn.style.left = `${sx}px`;
      seatBtn.style.top = `${sy}px`;
      seatBtn.innerHTML = `
        <span class="preview-seat-dot">${idx + 1}</span>
        <span class="preview-seat-label">${escapeHtml(guestName)}</span>
      `;
      seatBtn.addEventListener("click", () => renderModalPreview(table, idx));
      modalRoundPreview.appendChild(seatBtn);

      const li = document.createElement("li");
      li.className = "modal-guest-item" + (isActive ? " active" : "");
      li.innerHTML = `
        <span class="modal-seat-num">${idx + 1}</span>
        <span>${escapeHtml(guestName)}</span>
      `;
      li.addEventListener("click", () => renderModalPreview(table, idx));
      modalGuestList.appendChild(li);
    });
  }

  function closeTableModal() {
    tableModal.classList.add("hidden");
    document.body.style.overflow = "";
  }

  closeModalBtn.addEventListener("click", closeTableModal);
  tableModal.addEventListener("click", (e) => {
    if (e.target === tableModal) closeTableModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !tableModal.classList.contains("hidden")) {
      closeTableModal();
    }
  });

  btnLocateTableOnMap.addEventListener("click", () => {
    if (modalTableId === null) return;
    const id = modalTableId;
    closeTableModal();
    focusedTableId = id;
    switchView("floor");
    renderFloorTables();
    requestAnimationFrame(() => zoomToTable(id, true));
  });

  // ---------------- Utilities ----------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function highlightMatch(text, query) {
    const safe = escapeHtml(text);
    const q = query.trim();
    if (!q) return safe;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return safe;
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + q.length));
    const after = escapeHtml(text.slice(idx + q.length));
    return `${before}<mark>${match}</mark>${after}`;
  }

  // ---------------- Init ----------------
  renderFloorTables();
  fitToScreen(false);

  window.addEventListener("resize", () => {
    if (currentView === "floor") {
      if (focusedTableId !== null) {
        zoomToTable(focusedTableId, false);
      } else {
        fitToScreen(false);
      }
    }
  });
})();

const state = {
  uploads: [],
  leads: [],
  filters: {
    week: "",
    kam: "",
    status: "",
    search: "",
  },
};

const els = {
  uploadForm: document.querySelector("#uploadForm"),
  syncLocalButton: document.querySelector("#syncLocalButton"),
  weekInput: document.querySelector("#weekInput"),
  csvInput: document.querySelector("#csvInput"),
  weekFilter: document.querySelector("#weekFilter"),
  kamFilter: document.querySelector("#kamFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  searchInput: document.querySelector("#searchInput"),
  metricTotal: document.querySelector("#metricTotal"),
  metricHighRisk: document.querySelector("#metricHighRisk"),
  metricContacted: document.querySelector("#metricContacted"),
  metricPending: document.querySelector("#metricPending"),
  kamBreakdown: document.querySelector("#kamBreakdown"),
  leadTable: document.querySelector("#leadTable"),
  emptyState: document.querySelector("#emptyState"),
  dialog: document.querySelector("#leadDialog"),
  actionForm: document.querySelector("#actionForm"),
  selectedLeadId: document.querySelector("#selectedLeadId"),
  dialogLeadMeta: document.querySelector("#dialogLeadMeta"),
  dialogTitle: document.querySelector("#dialogTitle"),
  statusInput: document.querySelector("#statusInput"),
  followUpInput: document.querySelector("#followUpInput"),
  outcomeInput: document.querySelector("#outcomeInput"),
  actionInput: document.querySelector("#actionInput"),
  notesInput: document.querySelector("#notesInput"),
  cancelDialog: document.querySelector("#cancelDialog"),
};

const today = new Date().toISOString().slice(0, 10);
els.weekInput.value = today;

hydrate();

els.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = els.csvInput.files[0];
  if (!file) return;

  try {
    const csv = await file.text();
    const response = await api("/api/upload", {
      method: "POST",
      body: JSON.stringify({
        week: els.weekInput.value,
        fileName: file.name,
        csv,
      }),
    });

    setState(response);
    state.filters.week = els.weekInput.value;
    render();
  } catch (error) {
    alert(error.message);
  }
});

els.syncLocalButton.addEventListener("click", async () => {
  try {
    const response = await api("/api/import-local", {
      method: "POST",
      body: JSON.stringify({ week: els.weekInput.value }),
    });

    setState(response);
    state.filters.week = els.weekInput.value;
    render();
  } catch (error) {
    alert(error.message);
  }
});

els.weekFilter.addEventListener("change", () => {
  state.filters.week = els.weekFilter.value;
  state.filters.kam = "";
  render();
});

els.kamFilter.addEventListener("change", () => {
  state.filters.kam = els.kamFilter.value;
  render();
});

els.statusFilter.addEventListener("change", () => {
  state.filters.status = els.statusFilter.value;
  render();
});

els.searchInput.addEventListener("input", () => {
  state.filters.search = els.searchInput.value.trim().toLowerCase();
  render();
});

els.cancelDialog.addEventListener("click", () => els.dialog.close());

els.actionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await api("/api/action", {
    method: "POST",
    body: JSON.stringify({
      id: els.selectedLeadId.value,
      status: els.statusInput.value,
      next_follow_up: els.followUpInput.value,
      outcome: els.outcomeInput.value,
      action_taken: els.actionInput.value,
      notes: els.notesInput.value,
    }),
  });

  els.dialog.close();
  setState(response);
  render();
});

async function hydrate() {
  const response = await api("/api/state");
  setState(response);
  state.filters.week = latestWeek();
  render();
}

function setState(data) {
  state.uploads = data.uploads || [];
  state.leads = data.leads || [];
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function render() {
  renderFilters();
  const leads = filteredLeads();
  renderMetrics(leads);
  renderBreakdown(leads);
  renderTable(leads);
}

function renderFilters() {
  const weeks = unique(state.leads.map((lead) => lead.week)).sort().reverse();
  if (!state.filters.week && weeks.length) state.filters.week = weeks[0];

  els.weekFilter.innerHTML = [
    `<option value="">All weeks</option>`,
    ...weeks.map((week) => `<option ${week === state.filters.week ? "selected" : ""}>${escapeHtml(week)}</option>`),
  ].join("");

  const kamSource = state.filters.week
    ? state.leads.filter((lead) => lead.week === state.filters.week)
    : state.leads;
  const kams = unique(kamSource.map((lead) => lead.kam_name).filter(Boolean)).sort();

  els.kamFilter.innerHTML = [
    `<option value="">All KAMs</option>`,
    ...kams.map((kam) => `<option ${kam === state.filters.kam ? "selected" : ""}>${escapeHtml(kam)}</option>`),
  ].join("");
  els.statusFilter.value = state.filters.status;
  els.searchInput.value = state.filters.search;
}

function filteredLeads() {
  return state.leads
    .filter((lead) => !state.filters.week || lead.week === state.filters.week)
    .filter((lead) => !state.filters.kam || lead.kam_name === state.filters.kam)
    .filter((lead) => !state.filters.status || lead.status === state.filters.status)
    .filter((lead) => {
      if (!state.filters.search) return true;
      const haystack = `${lead.account_name} ${lead.lead_id} ${lead.kam_name}`.toLowerCase();
      return haystack.includes(state.filters.search);
    })
    .sort((a, b) => b.risk_score - a.risk_score || Number(b.revenue) - Number(a.revenue));
}

function renderMetrics(leads) {
  const contacted = leads.filter((lead) => !["New", "No Action"].includes(lead.status)).length;
  const pending = leads.filter((lead) => ["New", "No Action"].includes(lead.status)).length;
  const highRisk = leads.filter((lead) => ["Critical", "High"].includes(lead.risk_level)).length;

  els.metricTotal.textContent = leads.length;
  els.metricHighRisk.textContent = highRisk;
  els.metricContacted.textContent = leads.length ? `${Math.round((contacted / leads.length) * 100)}%` : "0%";
  els.metricPending.textContent = pending;
}

function renderBreakdown(leads) {
  const counts = new Map();
  for (const lead of leads) {
    const current = counts.get(lead.kam_name) || { total: 0, high: 0 };
    current.total += 1;
    if (["Critical", "High"].includes(lead.risk_level)) current.high += 1;
    counts.set(lead.kam_name, current);
  }

  const max = Math.max(1, ...Array.from(counts.values()).map((item) => item.total));
  els.kamBreakdown.innerHTML = Array.from(counts.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .map(([kam, item]) => `
      <div class="kam-row">
        <header>
          <strong>${escapeHtml(kam || "Unassigned")}</strong>
          <span>${item.total} ${item.total === 1 ? "lead" : "leads"} · ${item.high} high</span>
        </header>
        <div class="bar"><span style="width:${Math.max(5, (item.total / max) * 100)}%"></span></div>
      </div>
    `)
    .join("") || `<p class="muted">No leads in this view.</p>`;
}

function renderTable(leads) {
  els.leadTable.innerHTML = leads.map((lead) => `
    <tr data-id="${escapeHtml(lead.id)}">
      <td>
        <div class="lead-title">
          <strong>${escapeHtml(lead.account_name || "Unnamed account")}</strong>
          <span>${escapeHtml(lead.lead_id)} · ${formatMoney(lead.revenue)}</span>
        </div>
      </td>
      <td>${escapeHtml(lead.kam_name)}</td>
      <td>
        <span class="pill risk-${escapeHtml(String(lead.risk_level).toLowerCase())}">${escapeHtml(lead.risk_level)}</span>
        <div class="muted">${Math.round(lead.risk_score * 100)}%</div>
      </td>
      <td>${escapeHtml(lead.risk_reason || lead.segment || "-")}</td>
      <td>${escapeHtml(lead.status)}</td>
      <td>${escapeHtml(lead.next_follow_up || "-")}</td>
      <td>${escapeHtml(lead.outcome || "-")}</td>
    </tr>
  `).join("");

  els.emptyState.classList.toggle("visible", leads.length === 0);

  for (const row of els.leadTable.querySelectorAll("tr")) {
    row.addEventListener("click", () => openLead(row.dataset.id));
  }
}

function openLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) return;

  els.selectedLeadId.value = lead.id;
  els.dialogLeadMeta.textContent = `${lead.kam_name} · ${lead.risk_level} risk · ${Math.round(lead.risk_score * 100)}%`;
  els.dialogTitle.textContent = lead.account_name;
  els.statusInput.value = lead.status || "New";
  els.followUpInput.value = lead.next_follow_up || "";
  els.outcomeInput.value = lead.outcome || "";
  els.actionInput.value = lead.action_taken || "";
  els.notesInput.value = lead.notes || "";
  els.dialog.showModal();
}

function latestWeek() {
  return unique(state.leads.map((lead) => lead.week)).sort().reverse()[0] || "";
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!number) return "No value";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(number);
}

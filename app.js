/* ===========================
   Crypto Tracker — App Logic
   =========================== */

const API_BASE = "https://api.coingecko.com/api/v3";
const DEFAULT_CURRENCY = "usd";
const PAGE_SIZE = 50;          // coins per fetch
const AUTO_REFRESH_MS = 60_000; // 60s

// State
let coins = [];
let filteredCoins = [];
let watchlistOnly = false;
let currency = DEFAULT_CURRENCY;
let chartInstance = null;

// Elements
const tableBody = document.getElementById("tableBody");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const currencySelect = document.getElementById("currencySelect");
const toggleWatchBtn = document.getElementById("toggleWatch");
const refreshBtn = document.getElementById("refreshBtn");

const chartModal = document.getElementById("chartModal");
const closeModalBtn = document.getElementById("closeModal");
const priceCanvas = document.getElementById("priceChart");
const modalTitle = document.getElementById("modalTitle");
const modalSubtitle = document.getElementById("modalSubtitle");

// ---- Utils ----
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const currencySymbols = { usd: "$", inr: "₹", eur: "€" };
const sym = () => currencySymbols[currency] || "";

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem("watchlist") || "[]"); }
  catch { return []; }
}
function setWatchlist(list) {
  localStorage.setItem("watchlist", JSON.stringify(list));
}
function isWatched(id) {
  return getWatchlist().includes(id);
}
function toggleWatch(id) {
  const list = getWatchlist();
  const idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(id);
  setWatchlist(list);
}

// ---- Fetch coins list ----
async function fetchCoins() {
  statusEl.textContent = "Loading coins…";
  try {
    // markets endpoint provides price, 24h change, market cap, icons — no API key needed
    const url = `${API_BASE}/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${PAGE_SIZE}&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    coins = await res.json();
    filteredCoins = coins.slice();
    renderTable();
    statusEl.textContent = `Loaded ${coins.length} coins • ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    statusEl.textContent = `Failed to load coins. ${err.message}`;
    console.error(err);
  }
}

// ---- Render table ----
function renderTable() {
  const query = searchInput.value.trim().toLowerCase();
  const wl = getWatchlist();

  const list = coins.filter(c => {
    const matches = c.name.toLowerCase().includes(query) || c.symbol.toLowerCase().includes(query);
    const inWatch = !watchlistOnly || wl.includes(c.id);
    return matches && inWatch;
  });

  tableBody.innerHTML = list.map((c, i) => {
    const chg = c.price_change_percentage_24h;
    const chgClass = chg >= 0 ? "chg-pos" : "chg-neg";
    const mcap = c.market_cap ? `${sym()}${fmt0.format(c.market_cap)}` : "—";
    const price = c.current_price !== null && c.current_price !== undefined ? `${sym()}${fmt.format(c.current_price)}` : "—";
    const starActive = isWatched(c.id) ? "active" : "";
    return `
      <tr data-id="${c.id}" class="row">
        <td>${c.market_cap_rank ?? ""}</td>
        <td>
          <button class="coin btn-plain" data-action="open" title="View 24h chart for ${c.name}">
            <img src="${c.image}" alt="" loading="lazy">
            <span>${c.name}</span>
            <span class="sym">${c.symbol}</span>
          </button>
        </td>
        <td class="right">${price}</td>
        <td class="right"><span class="${chgClass}">${chg ? chg.toFixed(2) : "0.00"}%</span></td>
        <td class="right">${mcap}</td>
        <td class="center">
          <button class="watch ${starActive}" data-action="watch" title="Toggle watchlist">★</button>
        </td>
      </tr>
    `;
  }).join("");

  // Row event delegation
  tableBody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("click", onRowClick);
  });
}

function onRowClick(e) {
  const tr = e.currentTarget;
  const id = tr.getAttribute("data-id");
  const action = e.target.getAttribute("data-action");

  if (action === "watch") {
    e.stopPropagation();
    toggleWatch(id);
    renderTable();
    return;
  }
  // Open chart
  const coin = coins.find(c => c.id === id);
  if (coin) openChartModal(coin);
}

// ---- Chart Modal ----
async function openChartModal(coin) {
  modalTitle.textContent = `${coin.name} (${coin.symbol.toUpperCase()})`;
  modalSubtitle.textContent = `24h • ${new Date().toLocaleString()}`;

  // Fetch 1-day price series
  try {
    const url = `${API_BASE}/coins/${coin.id}/market_chart?vs_currency=${currency}&days=1&interval=minute`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const prices = data.prices || []; // [ [timestamp, price], ... ]

    const labels = prices.map(p => new Date(p[0]));
    const series = prices.map(p => p[1]);

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    chartInstance = new Chart(priceCanvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: `${coin.name} price (${currency.toUpperCase()})`,
          data: series,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
          fill: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "time",
            time: { unit: "hour" },
            grid: { display: false },
            ticks: { color: "#8b93a6" }
          },
          y: {
            grid: { color: "rgba(255,255,255,.06)" },
            ticks: {
              color: "#8b93a6",
              callback: (v) => `${sym()}${v}`
            }
          }
        },
        plugins: {
          legend: { labels: { color: "#e7eaf3" } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${sym()}${ctx.parsed.y.toLocaleString()}`
            }
          }
        }
      }
    });

    chartModal.showModal();
  } catch (err) {
    alert("Failed to load chart data. Try again.");
    console.error(err);
  }
}

closeModalBtn.addEventListener("click", (e) => {
  e.preventDefault();
  chartModal.close();
});

// ---- Search & Filters ----
searchInput.addEventListener("input", renderTable);
currencySelect.addEventListener("change", async () => {
  currency = currencySelect.value;
  await fetchCoins();
});
toggleWatchBtn.addEventListener("click", () => {
  watchlistOnly = !watchlistOnly;
  toggleWatchBtn.setAttribute("aria-pressed", String(watchlistOnly));
  toggleWatchBtn.classList.toggle("btn", watchlistOnly);
  toggleWatchBtn.classList.toggle("btn-outline", !watchlistOnly);
  renderTable();
});
refreshBtn.addEventListener("click", fetchCoins);

// ---- Auto refresh ----
setInterval(fetchCoins, AUTO_REFRESH_MS);

// ---- Accessibility / minor styles for row buttons ----
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("btn-plain")) e.preventDefault();
});

// Initialize
fetchCoins();

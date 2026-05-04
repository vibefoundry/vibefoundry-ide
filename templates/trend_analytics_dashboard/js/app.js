import "chart.js/auto";
import { Chart } from "chart.js/auto";
import "../css/styles.css";

(function () {
  "use strict";

  var h = React.createElement;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;

  // Behavior constants
  var PAGE_SIZE = 100;
  var EXPORT_LIMIT = 1000000;
  var BAR_TOP_N = 10;

  // Channel colors — consistent with the geo dashboard template
  var CHANNEL_COLOR = {
    Restaurant: "#c2410c",
    Retail: "#0e7490",
    Wholesale: "#7e22ce"
  };
  var CHANNEL_FALLBACK = "#94a3b8";

  // Data-shape constants — populated from public/data/app_config.json by loadAppConfig().
  var DATA_FILE = null;
  var COLUMNS = [];
  var NUMERIC_COLUMNS = {};
  var CATEGORICAL_COLUMNS = [];

  async function loadAppConfig() {
    var resp = await fetch("data/app_config.json");
    if (!resp.ok) {
      throw new Error("Failed to load app_config.json (HTTP " + resp.status + ")");
    }
    var config = await resp.json();
    DATA_FILE = config.data.file;
    COLUMNS = config.columns.map(function (c) { return c.name; });
    NUMERIC_COLUMNS = {};
    config.columns.forEach(function (c) {
      if (c.type === "numeric") {
        NUMERIC_COLUMNS[c.name] = true;
      }
    });
    CATEGORICAL_COLUMNS = COLUMNS.filter(function (col) { return !NUMERIC_COLUMNS[col]; });
    return config;
  }

  function escapeSql(value) {
    return String(value).replace(/'/g, "''");
  }

  function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  function quoteLiteral(value) {
    return "'" + escapeSql(value) + "'";
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "";
    }
    return Number(value).toLocaleString(undefined, {
      maximumFractionDigits: digits === undefined ? 2 : digits
    });
  }

  function normalizeCell(value) {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "number") {
      return Number.isInteger(value) ? String(value) : String(Math.round(value * 10000) / 10000);
    }
    return String(value);
  }

  function resultToRows(result) {
    var rows = [];
    var fields = result.schema.fields.map(function (field) { return field.name; });
    for (var i = 0; i < result.numRows; i += 1) {
      var row = {};
      for (var j = 0; j < fields.length; j += 1) {
        row[fields[j]] = result.getChild(fields[j]).get(i);
      }
      rows.push(row);
    }
    return rows;
  }

  function csvValue(value) {
    var text = normalizeCell(value);
    if (/[",\n\r]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function downloadBuffer(filename, buffer, mimeType) {
    var blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportQueryToCsv(db, filename, selectSql) {
    var tempName = "tmp_" + Date.now() + "_" + Math.random().toString(36).slice(2) + ".csv";
    var conn = await db.connect();
    try {
      await conn.query(
        "COPY (" + selectSql + ") TO " + quoteLiteral(tempName) + " WITH (HEADER, DELIMITER ',')"
      );
      var buffer = await db.copyFileToBuffer(tempName);
      downloadBuffer(filename, buffer, "text/csv;charset=utf-8");
    } finally {
      await conn.close();
      try {
        await db.dropFile(tempName);
      } catch (dropErr) {
        console.warn("Unable to drop temporary export file", dropErr);
      }
    }
  }

  async function initDuckDB() {
    var baseUrl = new URL(".", window.location.href).href;
    var worker = new Worker(baseUrl + "lib/duckdb-browser-eh.worker.js");
    var logger = new window.duckdb.ConsoleLogger();
    var db = new window.duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(baseUrl + "lib/duckdb-eh.wasm");
    var dataResp = await fetch("data/" + DATA_FILE);
    var buffer = new Uint8Array(await dataResp.arrayBuffer());
    await db.registerFileBuffer(DATA_FILE, buffer);
    return db;
  }

  function baseFrom() {
    return "read_parquet(" + quoteLiteral(DATA_FILE) + ")";
  }

  function buildWhere(filters, tableFilters) {
    var clauses = [];
    if (filters.geoState) {
      clauses.push(quoteIdent("State Name") + " = " + quoteLiteral(filters.geoState));
    }
    if (filters.countyGeoId) {
      clauses.push(quoteIdent("County GEOID") + " = " + quoteLiteral(filters.countyGeoId));
    }
    if (filters.state) {
      clauses.push(quoteIdent("State") + " = " + quoteLiteral(filters.state));
    }
    if (filters.channel) {
      clauses.push(quoteIdent("Channel") + " = " + quoteLiteral(filters.channel));
    }
    if (filters.visitationPriority) {
      clauses.push(quoteIdent("Account Tier") + " = " + quoteLiteral(filters.visitationPriority));
    }
    if (filters.outlet) {
      clauses.push(quoteIdent("Account Code") + " ILIKE " + quoteLiteral("%" + filters.outlet + "%"));
    }
    if (filters.brand) {
      clauses.push(quoteIdent("Brand") + " ILIKE " + quoteLiteral("%" + filters.brand + "%"));
    }
    if (filters.variant) {
      clauses.push(quoteIdent("Variety") + " ILIKE " + quoteLiteral("%" + filters.variant + "%"));
    }
    if (filters.size) {
      clauses.push(quoteIdent("Size_ML") + " = " + Number(filters.size));
    }
    if (filters.fy25Min) {
      clauses.push(quoteIdent("Cases 2025") + " >= " + Number(filters.fy25Min));
    }
    if (filters.fy25Max) {
      clauses.push(quoteIdent("Cases 2025") + " <= " + Number(filters.fy25Max));
    }
    if (filters.fy26Min) {
      clauses.push(quoteIdent("Cases 2026") + " >= " + Number(filters.fy26Min));
    }
    if (filters.fy26Max) {
      clauses.push(quoteIdent("Cases 2026") + " <= " + Number(filters.fy26Max));
    }
    Object.keys(tableFilters || {}).forEach(function (col) {
      if (NUMERIC_COLUMNS[col]) {
        var range = tableFilters[col] || {};
        if (range.min !== undefined && range.min !== "") {
          clauses.push(quoteIdent(col) + " >= " + Number(range.min));
        }
        if (range.max !== undefined && range.max !== "") {
          clauses.push(quoteIdent(col) + " <= " + Number(range.max));
        }
      } else {
        var value = String(tableFilters[col] || "").trim();
        if (value) {
          clauses.push(quoteIdent(col) + " = " + quoteLiteral(value));
        }
      }
    });
    return clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  }

  function defaultFilters() {
    return {
      state: "",
      geoState: "",
      countyGeoId: "",
      channel: "",
      visitationPriority: "",
      outlet: "",
      brand: "",
      variant: "",
      size: "",
      fy25Min: "",
      fy25Max: "",
      fy26Min: "",
      fy26Max: ""
    };
  }

  function FilterSelect(props) {
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("select", {
        value: props.value,
        onChange: function (event) { props.onChange(event.target.value); }
      },
        h("option", { value: "" }, "All"),
        props.options.map(function (option) {
          var value = option && typeof option === "object" ? option.value : option;
          var label = option && typeof option === "object" ? option.label : option;
          return h("option", { key: String(value), value: String(value) }, String(label));
        })
      )
    );
  }

  function FilterText(props) {
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("input", {
        value: props.value,
        placeholder: props.placeholder || "",
        onChange: function (event) { props.onChange(event.target.value); }
      })
    );
  }

  function FilterRange(props) {
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("div", { className: "range-row" },
        h("input", {
          type: "number",
          value: props.min,
          placeholder: "Min",
          onChange: function (event) { props.onMin(event.target.value); }
        }),
        h("input", {
          type: "number",
          value: props.max,
          placeholder: "Max",
          onChange: function (event) { props.onMax(event.target.value); }
        })
      )
    );
  }

  function Sidebar(props) {
    var filters = props.filters;
    function setFilter(key, value) {
      props.onChange(Object.assign({}, filters, (function () {
        var obj = {};
        obj[key] = value;
        return obj;
      })()));
    }
    return h("aside", { className: "sidebar" },
      h("div", { className: "brand-bar" },
        h("h1", null, "Trend Analytics Dashboard"),
        h("div", { className: "subtitle" }, "Sales mix and year-over-year trends across accounts")
      ),
      h("div", { className: "filter-list" },
        h(FilterSelect, { label: "Geo State", value: filters.geoState, options: props.options.geoStates, onChange: function (v) { setFilter("geoState", v); } }),
        h(FilterSelect, { label: "County", value: filters.countyGeoId, options: props.options.counties, onChange: function (v) { setFilter("countyGeoId", v); } }),
        h(FilterSelect, { label: "State", value: filters.state, options: props.options.states, onChange: function (v) { setFilter("state", v); } }),
        h(FilterSelect, { label: "Channel", value: filters.channel, options: props.options.channels, onChange: function (v) { setFilter("channel", v); } }),
        h(FilterSelect, { label: "Account Tier", value: filters.visitationPriority, options: props.options.visitationPriorities, onChange: function (v) { setFilter("visitationPriority", v); } }),
        h(FilterText, { label: "Account", value: filters.outlet, placeholder: "Search account code", onChange: function (v) { setFilter("outlet", v); } }),
        h(FilterText, { label: "Brand", value: filters.brand, placeholder: "Search brand", onChange: function (v) { setFilter("brand", v); } }),
        h(FilterText, { label: "Variety", value: filters.variant, placeholder: "Search variety", onChange: function (v) { setFilter("variant", v); } }),
        h(FilterSelect, { label: "Size (mL)", value: filters.size, options: props.options.sizes, onChange: function (v) { setFilter("size", v); } }),
        h(FilterRange, {
          label: "Cases 2025",
          min: filters.fy25Min,
          max: filters.fy25Max,
          onMin: function (v) { setFilter("fy25Min", v); },
          onMax: function (v) { setFilter("fy25Max", v); }
        }),
        h(FilterRange, {
          label: "Cases 2026",
          min: filters.fy26Min,
          max: filters.fy26Max,
          onMin: function (v) { setFilter("fy26Min", v); },
          onMax: function (v) { setFilter("fy26Max", v); }
        })
      ),
      h("div", { className: "sidebar-actions" },
        h("button", { onClick: props.onReset }, "Reset"),
        h("button", { className: "primary", onClick: props.onExport, disabled: props.exporting }, props.exporting ? "Exporting..." : "Export CSV")
      )
    );
  }

  function ChartCanvas(props) {
    var canvasRef = useRef(null);
    var chartRef = useRef(null);
    useEffect(function () {
      if (!canvasRef.current) return;
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      if (!props.config) return;
      chartRef.current = new Chart(canvasRef.current, props.config);
      return function () {
        if (chartRef.current) {
          chartRef.current.destroy();
          chartRef.current = null;
        }
      };
    }, [props.configKey]);
    return h("canvas", { ref: canvasRef });
  }

  function ChartCard(props) {
    return h("div", { className: "chart-card" },
      h("div", { className: "chart-card-header" },
        h("h3", null, props.title),
        h("div", { className: props.error ? "status error" : "status" }, props.status || "")
      ),
      h("div", { className: "chart-card-body" },
        props.empty
          ? h("div", { className: "empty-state" }, "No data for current filters.")
          : h(ChartCanvas, { config: props.config, configKey: props.configKey })
      )
    );
  }

  function buildPieConfig(rows) {
    var labels = rows.map(function (r) { return r.Channel; });
    var data = rows.map(function (r) { return Number(r.account_count) || 0; });
    var colors = labels.map(function (lbl) { return CHANNEL_COLOR[lbl] || CHANNEL_FALLBACK; });
    return {
      type: "pie",
      data: {
        labels: labels,
        datasets: [{ data: data, backgroundColor: colors, borderColor: "#fff", borderWidth: 2 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var label = ctx.label || "";
                var val = ctx.parsed;
                return label + ": " + formatNumber(val, 0) + " accounts";
              }
            }
          }
        }
      }
    };
  }

  function buildBarConfig(rows) {
    var labels = rows.map(function (r) { return r.Brand; });
    var data = rows.map(function (r) { return Number(r.total_cases) || 0; });
    return {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          label: "Total Cases (2024–2026)",
          data: data,
          backgroundColor: "#0e7490",
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return formatNumber(ctx.parsed.x, 0) + " cases"; }
            }
          }
        },
        scales: {
          x: { ticks: { callback: function (v) { return formatNumber(v, 0); } } },
          y: { ticks: { font: { size: 11 } } }
        }
      }
    };
  }

  function buildLineConfig(rows) {
    var datasets = rows.map(function (r) {
      var label = r.Channel;
      return {
        label: label,
        data: [
          Number(r.y2024) || 0,
          Number(r.y2025) || 0,
          Number(r.y2026) || 0
        ],
        borderColor: CHANNEL_COLOR[label] || CHANNEL_FALLBACK,
        backgroundColor: CHANNEL_COLOR[label] || CHANNEL_FALLBACK,
        tension: 0.25,
        pointRadius: 4,
        borderWidth: 2,
        fill: false
      };
    });
    return {
      type: "line",
      data: {
        labels: ["2024", "2025", "2026"],
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ": " + formatNumber(ctx.parsed.y, 0) + " cases";
              }
            }
          }
        },
        scales: {
          y: { ticks: { callback: function (v) { return formatNumber(v, 0); } } }
        }
      }
    };
  }

  function DataTable(props) {
    var totalPages = Math.max(1, Math.ceil(props.totalRows / PAGE_SIZE));
    var activeFilterColState = useState(null);
    var activeFilterCol = activeFilterColState[0];
    var setActiveFilterCol = activeFilterColState[1];

    function sortLabel(col) {
      if (props.sort.col !== col) return col;
      return col + (props.sort.dir === "ASC" ? " ↑" : " ↓");
    }

    function hasActiveFilter(col) {
      if (NUMERIC_COLUMNS[col]) {
        var range = props.tableFilters[col] || {};
        return !!(range.min || range.max);
      }
      return !!String(props.tableFilters[col] || "").trim();
    }

    function renderFilterPopover(col) {
      if (activeFilterCol !== col) return null;
      if (NUMERIC_COLUMNS[col]) {
        var range = props.tableFilters[col] || {};
        return h("div", { className: "filter-popover", onClick: function (event) { event.stopPropagation(); } },
          h("div", { className: "table-range" },
            h("input", {
              type: "number",
              value: range.min || "",
              placeholder: "Min",
              onChange: function (event) { props.onTableFilter(col, "min", event.target.value); }
            }),
            h("input", {
              type: "number",
              value: range.max || "",
              placeholder: "Max",
              onChange: function (event) { props.onTableFilter(col, "max", event.target.value); }
            })
          ),
          h("button", {
            className: "filter-clear",
            onClick: function () {
              props.onTableFilter(col, "min", "");
              props.onTableFilter(col, "max", "");
            }
          }, "Clear")
        );
      }
      return h("div", { className: "filter-popover", onClick: function (event) { event.stopPropagation(); } },
        h("input", {
          value: props.tableFilters[col] || "",
          placeholder: "Type to filter",
          onChange: function (event) { props.onTableFilter(col, "value", event.target.value); }
        }),
        h("button", {
          className: "filter-clear",
          onClick: function () { props.onTableFilter(col, "value", ""); }
        }, "Clear")
      );
    }

    function renderSummaryRow(label, key, rowClassName) {
      return h("tr", { className: "summary-row " + rowClassName }, COLUMNS.map(function (col) {
        if (col === COLUMNS[0]) return h("th", { key: col }, label);
        if (!NUMERIC_COLUMNS[col]) return h("th", { key: col }, "");
        var value = props.summary[col] ? props.summary[col][key] : null;
        return h("th", { key: col, className: "numeric" }, formatNumber(value, key === "avg" ? 2 : 0));
      }));
    }

    return h("section", { className: "table-panel" },
      h("div", { className: "table-toolbar" },
        h("h2", null, "Account Details"),
        h("div", { className: "table-toolbar-actions" },
          h("div", { className: props.error ? "status error" : "status" }, props.status),
          h("button", {
            type: "button",
            className: "primary",
            onClick: props.onExport,
            disabled: props.exporting
          }, props.exporting ? "Exporting..." : "Export CSV")
        )
      ),
      h("div", { className: "table-wrap" },
        props.rows.length === 0
          ? h("div", { className: "empty-state" }, "No rows match the current filters.")
          : h("table", null,
            h("thead", null,
              renderSummaryRow("Sum", "sum", "summary-sum"),
              renderSummaryRow("Count", "count", "summary-count"),
              renderSummaryRow("Average", "avg", "summary-avg"),
              h("tr", { className: "header-row" }, COLUMNS.map(function (col) {
                return h("th", {
                  key: col,
                  className: NUMERIC_COLUMNS[col] ? "numeric" : "",
                  onClick: function () { props.onSort(col); }
                },
                  h("div", { className: "header-cell" },
                    h("span", { className: "header-label" }, sortLabel(col)),
                    h("button", {
                      className: hasActiveFilter(col) ? "filter-toggle active" : "filter-toggle",
                      onClick: function (event) {
                        event.stopPropagation();
                        setActiveFilterCol(activeFilterCol === col ? null : col);
                      }
                    }, "▼"),
                    renderFilterPopover(col)
                  )
                );
              })),
            ),
            h("tbody", null, props.rows.map(function (row, index) {
              return h("tr", { key: index }, COLUMNS.map(function (col) {
                var value = NUMERIC_COLUMNS[col] ? formatNumber(row[col]) : normalizeCell(row[col]);
                return h("td", { key: col, className: NUMERIC_COLUMNS[col] ? "numeric" : "" }, value);
              }));
            }))
          )
      ),
      h("div", { className: "pager" },
        h("div", null, "Page " + (props.page + 1) + " of " + formatNumber(totalPages, 0) + " · " + formatNumber(props.totalRows, 0) + " rows"),
        h("div", { className: "pager-buttons" },
          h("button", { onClick: function () { props.onPage(0); }, disabled: props.page === 0 }, "First"),
          h("button", { onClick: function () { props.onPage(Math.max(0, props.page - 1)); }, disabled: props.page === 0 }, "Prev"),
          h("button", { onClick: function () { props.onPage(Math.min(totalPages - 1, props.page + 1)); }, disabled: props.page >= totalPages - 1 }, "Next")
        )
      )
    );
  }

  function App() {
    var dbRef = useRef(null);
    var chartQuerySeq = useRef(0);
    var tableQuerySeq = useRef(0);
    var [ready, setReady] = useState(false);
    var [initError, setInitError] = useState("");
    var [options, setOptions] = useState({
      geoStates: [], counties: [], states: [], channels: [],
      visitationPriorities: [], brands: [], variants: [], sizes: [], table: {}
    });
    var [filters, setFilters] = useState(defaultFilters());
    var [tableFilters, setTableFilters] = useState({});
    var [sort, setSort] = useState({ col: "Cases 2026", dir: "DESC" });
    var [page, setPage] = useState(0);
    var [rows, setRows] = useState([]);
    var [tableTotalRows, setTableTotalRows] = useState(0);
    var [tableSummary, setTableSummary] = useState({});
    var [tableStatus, setTableStatus] = useState("Loading table...");
    var [pieRows, setPieRows] = useState([]);
    var [barRows, setBarRows] = useState([]);
    var [lineRows, setLineRows] = useState([]);
    var [chartStatus, setChartStatus] = useState("Loading charts...");
    var [chartError, setChartError] = useState("");
    var [headlineMetrics, setHeadlineMetrics] = useState({ accounts: 0, total24: 0, total25: 0, total26: 0 });
    var [queryError, setQueryError] = useState("");
    var [exporting, setExporting] = useState(false);

    // Bootstrap: init DuckDB + populate filter options
    useEffect(function () {
      var cancelled = false;
      async function boot() {
        try {
          var db = await initDuckDB();
          if (cancelled) return;
          dbRef.current = db;
          var conn = await db.connect();
          var optionResults = {};
          for (var i = 0; i < CATEGORICAL_COLUMNS.length; i += 1) {
            var col = CATEGORICAL_COLUMNS[i];
            optionResults[col] = await conn.query(
              "SELECT DISTINCT " + quoteIdent(col) + " FROM " + baseFrom() +
              " WHERE " + quoteIdent(col) + " IS NOT NULL ORDER BY " + quoteIdent(col)
            );
          }
          var sizeResult = await conn.query("SELECT DISTINCT " + quoteIdent("Size_ML") + " FROM " + baseFrom() + " WHERE " + quoteIdent("Size_ML") + " IS NOT NULL ORDER BY " + quoteIdent("Size_ML"));
          var geoStateResult = await conn.query(
            "SELECT DISTINCT " + quoteIdent("State Name") + " FROM " + baseFrom() +
            " WHERE " + quoteIdent("State Name") + " IS NOT NULL ORDER BY " + quoteIdent("State Name")
          );
          var countyResult = await conn.query(
            "SELECT DISTINCT " + quoteIdent("County GEOID") + ", " + quoteIdent("County Name") + ", " + quoteIdent("State Name") +
            " FROM " + baseFrom() +
            " WHERE " + quoteIdent("County GEOID") + " IS NOT NULL ORDER BY " + quoteIdent("State Name") + ", " + quoteIdent("County Name")
          );
          await conn.close();
          var tableOptions = {};
          CATEGORICAL_COLUMNS.forEach(function (col) {
            tableOptions[col] = resultToRows(optionResults[col]).map(function (r) { return r[col]; });
          });
          var countyOptions = resultToRows(countyResult).map(function (row) {
            return { value: row["County GEOID"], label: row["County Name"] + ", " + row["State Name"] };
          });
          setOptions({
            geoStates: resultToRows(geoStateResult).map(function (r) { return r["State Name"]; }),
            counties: countyOptions,
            states: tableOptions.State || [],
            channels: tableOptions.Channel || [],
            visitationPriorities: tableOptions["Account Tier"] || [],
            brands: tableOptions.Brand || [],
            variants: tableOptions["Variety"] || [],
            sizes: resultToRows(sizeResult).map(function (r) { return r["Size_ML"]; }),
            table: tableOptions
          });
          setReady(true);
        } catch (err) {
          setInitError(err && err.message ? err.message : String(err));
        }
      }
      boot();
      return function () { cancelled = true; };
    }, []);

    var filtersKey = useMemo(function () { return JSON.stringify(filters); }, [filters]);

    var tableKey = useMemo(function () {
      return JSON.stringify({ filters: filters, tableFilters: tableFilters, sort: sort, page: page });
    }, [filters, tableFilters, sort, page]);

    // Chart query effect — driven by sidebar filters only
    useEffect(function () {
      if (!ready || !dbRef.current) return;
      var seq = chartQuerySeq.current + 1;
      chartQuerySeq.current = seq;
      var cancelled = false;
      async function runChartQueries() {
        setChartError("");
        setChartStatus("Querying charts...");
        try {
          var conn = await dbRef.current.connect();
          var where = buildWhere(filters);

          var headlineSql =
            "SELECT COUNT(DISTINCT " + quoteIdent("Account Code") + ") AS accounts," +
            " SUM(" + quoteIdent("Cases 2024") + ") AS total24," +
            " SUM(" + quoteIdent("Cases 2025") + ") AS total25," +
            " SUM(" + quoteIdent("Cases 2026") + ") AS total26" +
            " FROM " + baseFrom() + where;

          var pieSql =
            "SELECT " + quoteIdent("Channel") + " AS Channel," +
            " COUNT(DISTINCT " + quoteIdent("Account Code") + ") AS account_count" +
            " FROM " + baseFrom() + where +
            (where ? " AND " : " WHERE ") + quoteIdent("Channel") + " IS NOT NULL" +
            " GROUP BY " + quoteIdent("Channel") +
            " ORDER BY account_count DESC";

          var barSql =
            "SELECT " + quoteIdent("Brand") + " AS Brand," +
            " SUM(COALESCE(" + quoteIdent("Cases 2024") + ", 0) + COALESCE(" + quoteIdent("Cases 2025") + ", 0) + COALESCE(" + quoteIdent("Cases 2026") + ", 0)) AS total_cases" +
            " FROM " + baseFrom() + where +
            (where ? " AND " : " WHERE ") + quoteIdent("Brand") + " IS NOT NULL" +
            " GROUP BY " + quoteIdent("Brand") +
            " ORDER BY total_cases DESC LIMIT " + BAR_TOP_N;

          var lineSql =
            "SELECT " + quoteIdent("Channel") + " AS Channel," +
            " SUM(" + quoteIdent("Cases 2024") + ") AS y2024," +
            " SUM(" + quoteIdent("Cases 2025") + ") AS y2025," +
            " SUM(" + quoteIdent("Cases 2026") + ") AS y2026" +
            " FROM " + baseFrom() + where +
            (where ? " AND " : " WHERE ") + quoteIdent("Channel") + " IS NOT NULL" +
            " GROUP BY " + quoteIdent("Channel") +
            " ORDER BY Channel";

          var headlineResult = await conn.query(headlineSql);
          var pieResult = await conn.query(pieSql);
          var barResult = await conn.query(barSql);
          var lineResult = await conn.query(lineSql);
          await conn.close();
          if (cancelled || seq !== chartQuerySeq.current) return;

          var headlineRow = resultToRows(headlineResult)[0] || {};
          setHeadlineMetrics({
            accounts: Number(headlineRow.accounts) || 0,
            total24: Number(headlineRow.total24) || 0,
            total25: Number(headlineRow.total25) || 0,
            total26: Number(headlineRow.total26) || 0
          });
          setPieRows(resultToRows(pieResult));
          setBarRows(resultToRows(barResult));
          setLineRows(resultToRows(lineResult));
          setChartStatus("");
        } catch (err) {
          if (cancelled || seq !== chartQuerySeq.current) return;
          var message = err && err.message ? err.message : String(err);
          setChartError(message);
          setChartStatus(message);
        }
      }
      runChartQueries();
      return function () { cancelled = true; };
    }, [ready, filtersKey]);

    // Table query effect — driven by all filters + sort + page
    useEffect(function () {
      if (!ready || !dbRef.current) return;
      var seq = tableQuerySeq.current + 1;
      tableQuerySeq.current = seq;
      var cancelled = false;
      async function runTableQueries() {
        setQueryError("");
        setTableStatus("Querying account details...");
        try {
          var conn = await dbRef.current.connect();
          var where = buildWhere(filters, tableFilters);
          var countSql = "SELECT COUNT(*) AS total_rows FROM " + baseFrom() + where;
          var summaryParts = [];
          COLUMNS.forEach(function (col) {
            if (NUMERIC_COLUMNS[col]) {
              summaryParts.push("SUM(" + quoteIdent(col) + ") AS " + quoteIdent(col + "__sum"));
              summaryParts.push("COUNT(" + quoteIdent(col) + ") AS " + quoteIdent(col + "__count"));
              summaryParts.push("AVG(" + quoteIdent(col) + ") AS " + quoteIdent(col + "__avg"));
            }
          });
          var summarySql = summaryParts.length
            ? "SELECT " + summaryParts.join(", ") + " FROM " + baseFrom() + where
            : null;
          var rowsSql = "SELECT " + COLUMNS.map(quoteIdent).join(", ") +
            " FROM " + baseFrom() + where +
            " ORDER BY " + quoteIdent(sort.col) + " " + sort.dir + " NULLS LAST" +
            " LIMIT " + PAGE_SIZE + " OFFSET " + (page * PAGE_SIZE);

          var countResult = await conn.query(countSql);
          var summaryResult = summarySql ? await conn.query(summarySql) : null;
          var rowsResult = await conn.query(rowsSql);
          await conn.close();
          if (cancelled || seq !== tableQuerySeq.current) return;

          var totalRows = Number(resultToRows(countResult)[0].total_rows || 0);
          setTableTotalRows(totalRows);
          var summary = {};
          if (summaryResult) {
            var s = resultToRows(summaryResult)[0] || {};
            COLUMNS.forEach(function (col) {
              if (NUMERIC_COLUMNS[col]) {
                summary[col] = {
                  sum: Number(s[col + "__sum"]) || 0,
                  count: Number(s[col + "__count"]) || 0,
                  avg: Number(s[col + "__avg"]) || 0
                };
              }
            });
          }
          setTableSummary(summary);
          setRows(resultToRows(rowsResult));
          setTableStatus(totalRows === 0 ? "No rows" : "Showing " +
            formatNumber(Math.min(PAGE_SIZE, totalRows - page * PAGE_SIZE), 0) +
            " of " + formatNumber(totalRows, 0));
        } catch (err) {
          if (cancelled || seq !== tableQuerySeq.current) return;
          var message = err && err.message ? err.message : String(err);
          setQueryError(message);
          setTableStatus(message);
        }
      }
      runTableQueries();
      return function () { cancelled = true; };
    }, [ready, tableKey]);

    function updateFilters(next) {
      setFilters(next);
      setPage(0);
    }
    function updateTableFilter(col, part, value) {
      var next = Object.assign({}, tableFilters);
      if (NUMERIC_COLUMNS[col]) {
        next[col] = Object.assign({}, next[col] || {}, (function () {
          var obj = {}; obj[part] = value; return obj;
        })());
        if (!next[col].min && !next[col].max) delete next[col];
      } else {
        next[col] = value;
        if (!value) delete next[col];
      }
      setTableFilters(next);
      setPage(0);
    }
    function updateSort(col) {
      if (sort.col === col) {
        setSort({ col: col, dir: sort.dir === "ASC" ? "DESC" : "ASC" });
      } else {
        setSort({ col: col, dir: NUMERIC_COLUMNS[col] ? "DESC" : "ASC" });
      }
      setPage(0);
    }
    async function exportCsv() {
      if (!dbRef.current || exporting) return;
      setExporting(true);
      setTableStatus("Preparing CSV export...");
      try {
        var where = buildWhere(filters, tableFilters);
        var conn = await dbRef.current.connect();
        var countResult = await conn.query("SELECT COUNT(*) AS total_rows FROM " + baseFrom() + where);
        await conn.close();
        var totalRows = Number(resultToRows(countResult)[0].total_rows || 0);
        var sql = "SELECT " + COLUMNS.map(quoteIdent).join(", ") + " FROM " + baseFrom() + where +
          " ORDER BY " + quoteIdent(sort.col) + " " + sort.dir + " NULLS LAST LIMIT " + EXPORT_LIMIT;
        await exportQueryToCsv(dbRef.current, "trend_dashboard_export.csv", sql);
        setTableStatus(totalRows > EXPORT_LIMIT
          ? "Exported first " + formatNumber(EXPORT_LIMIT, 0) + " of " + formatNumber(totalRows, 0) + " rows"
          : "Exported " + formatNumber(totalRows, 0) + " rows");
      } catch (err) {
        setQueryError(err && err.message ? err.message : String(err));
        setTableStatus(err && err.message ? err.message : String(err));
      } finally {
        setExporting(false);
      }
    }

    if (initError) {
      return h("div", { className: "app-error" },
        h("strong", null, "Unable to load the dashboard"),
        h("div", null, initError)
      );
    }
    if (!ready) {
      return h("div", { className: "app-loading" },
        h("div", { className: "spinner" }),
        h("div", null, "Loading DuckDB-WASM and account data...")
      );
    }

    var pieEmpty = pieRows.length === 0;
    var barEmpty = barRows.length === 0;
    var lineEmpty = lineRows.length === 0;
    var pieConfig = pieEmpty ? null : buildPieConfig(pieRows);
    var barConfig = barEmpty ? null : buildBarConfig(barRows);
    var lineConfig = lineEmpty ? null : buildLineConfig(lineRows);

    return h("div", { className: "dashboard" },
      h(Sidebar, {
        filters: filters,
        options: options,
        onChange: updateFilters,
        onReset: function () {
          setFilters(defaultFilters());
          setTableFilters({});
          setPage(0);
        },
        onExport: exportCsv,
        exporting: exporting
      }),
      h("main", { className: "trend-content" },
        h("div", { className: "trend-metrics" },
          h("div", { className: "metric" }, h("span", { className: "label" }, "Accounts"), formatNumber(headlineMetrics.accounts, 0)),
          h("div", { className: "metric" }, h("span", { className: "label" }, "Cases 2024"), formatNumber(headlineMetrics.total24, 0)),
          h("div", { className: "metric" }, h("span", { className: "label" }, "Cases 2025"), formatNumber(headlineMetrics.total25, 0)),
          h("div", { className: "metric" }, h("span", { className: "label" }, "Cases 2026"), formatNumber(headlineMetrics.total26, 0)),
          h("div", { className: chartError ? "status error" : "status" }, chartStatus || "")
        ),
        h("div", { className: "charts-grid" },
          h(ChartCard, {
            title: "Accounts by Channel",
            config: pieConfig,
            configKey: filtersKey + ":pie",
            empty: pieEmpty,
            error: chartError
          }),
          h(ChartCard, {
            title: "Top " + BAR_TOP_N + " Brands by Total Cases",
            config: barConfig,
            configKey: filtersKey + ":bar",
            empty: barEmpty,
            error: chartError
          }),
          h(ChartCard, {
            title: "Cases per Year by Channel",
            config: lineConfig,
            configKey: filtersKey + ":line",
            empty: lineEmpty,
            error: chartError
          })
        ),
        h(DataTable, {
          rows: rows,
          totalRows: tableTotalRows,
          summary: tableSummary,
          page: page,
          sort: sort,
          tableFilters: tableFilters,
          options: options.table,
          status: tableStatus,
          error: queryError,
          onPage: setPage,
          onSort: updateSort,
          onTableFilter: updateTableFilter,
          onExport: exportCsv,
          exporting: exporting
        })
      )
    );
  }

  loadAppConfig()
    .then(function () {
      ReactDOM.createRoot(document.getElementById("root")).render(h(App));
    })
    .catch(function (err) {
      console.error("Failed to load app config:", err);
      var root = document.getElementById("root");
      if (root) {
        root.innerHTML = '<div class="initial-loading"><p>Failed to load app config:<br>' +
          (err && err.message ? err.message : String(err)) + "</p></div>";
      }
    });
})();

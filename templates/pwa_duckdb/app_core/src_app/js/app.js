(function () {
  "use strict";

  var h = React.createElement;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;

  // Behavior constants — leave hardcoded
  var PAGE_SIZE = 100;
  var EXPORT_LIMIT = 1000000;
  var TEXT_DEBOUNCE_MS = 300;

  // ---------- helpers ----------

  function escapeSql(value) { return String(value).replace(/'/g, "''"); }
  function quoteIdent(name) { return '"' + String(name).replace(/"/g, '""') + '"'; }
  function quoteLiteral(value) { return "'" + escapeSql(value) + "'"; }

  function isNumericType(t) {
    if (!t) return false;
    var u = String(t).toUpperCase();
    return /(INT|DECIMAL|DOUBLE|FLOAT|REAL|NUMERIC|HUGEINT)/.test(u);
  }
  function isDateType(t) {
    if (!t) return false;
    var u = String(t).toUpperCase();
    return /(DATE|TIMESTAMP|TIME)/.test(u);
  }
  function isBooleanType(t) {
    return String(t || "").toUpperCase() === "BOOLEAN";
  }

  function formatNumber(value) {
    if (value === null || value === undefined) return "";
    var n = Number(value);
    if (Number.isNaN(n)) return String(value);
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  function normalizeCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "bigint") return value.toString();
    if (value instanceof Date) {
      // Render as ISO date (yyyy-mm-dd) if midnight UTC, else full ISO
      var iso = value.toISOString();
      return value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0
        ? iso.slice(0, 10)
        : iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
    }
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (e) { return String(value); }
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
      try { await db.dropFile(tempName); } catch (e) { /* ignore */ }
    }
  }

  // ---------- config + DuckDB ----------

  async function loadAppConfig() {
    var resp = await fetch("data/app_config.json");
    if (!resp.ok) throw new Error("Failed to load data/app_config.json (HTTP " + resp.status + ")");
    var config = await resp.json();
    if (!config.datasets || !Array.isArray(config.datasets) || config.datasets.length === 0) {
      throw new Error("app_config.json must contain a non-empty 'datasets' array.");
    }
    config.datasets.forEach(function (ds, i) {
      if (!ds.id) throw new Error("Dataset #" + i + " is missing 'id'.");
      if (!ds.file) throw new Error("Dataset '" + ds.id + "' is missing 'file'.");
    });
    return config;
  }

  async function initDuckDB(datasets) {
    var baseUrl = new URL(".", window.location.href).href;
    var worker = new Worker(baseUrl + "lib/duckdb-browser-eh.worker.js");
    var logger = new window.duckdb.ConsoleLogger();
    var db = new window.duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(baseUrl + "lib/duckdb-eh.wasm");

    var registered = {};
    for (var i = 0; i < datasets.length; i += 1) {
      var file = datasets[i].file;
      if (registered[file]) continue;
      var resp = await fetch("data/" + file);
      if (!resp.ok) throw new Error("Failed to load data/" + file + " (HTTP " + resp.status + ")");
      var buffer = new Uint8Array(await resp.arrayBuffer());
      await db.registerFileBuffer(file, buffer);
      registered[file] = true;
    }
    return db;
  }

  function baseFrom(file) { return "read_parquet(" + quoteLiteral(file) + ")"; }

  async function describeDataset(db, file) {
    var conn = await db.connect();
    try {
      var result = await conn.query("DESCRIBE SELECT * FROM " + baseFrom(file));
      // DuckDB DESCRIBE columns: column_name, column_type, null, key, default, extra
      return resultToRows(result).map(function (row) {
        return { name: row.column_name, type: row.column_type };
      });
    } finally { await conn.close(); }
  }

  async function loadSelectOptions(db, file, columnNames) {
    if (!columnNames.length) return {};
    var conn = await db.connect();
    var out = {};
    try {
      for (var i = 0; i < columnNames.length; i += 1) {
        var col = columnNames[i];
        var sql = "SELECT DISTINCT " + quoteIdent(col) + " AS v FROM " + baseFrom(file) +
                  " WHERE " + quoteIdent(col) + " IS NOT NULL ORDER BY v LIMIT 1000";
        var r = await conn.query(sql);
        out[col] = resultToRows(r).map(function (row) { return row.v; });
      }
    } finally { await conn.close(); }
    return out;
  }

  function validateConfigAgainstSchema(dataset, schema) {
    var schemaCols = {};
    schema.forEach(function (s) { schemaCols[s.name] = true; });
    (dataset.columns || []).forEach(function (c) {
      if (!schemaCols[c.name]) {
        throw new Error("Column '" + c.name + "' (in app_config.json for dataset '" +
                        dataset.id + "') was not found in " + dataset.file + ".");
      }
    });
  }

  // ---------- WHERE builder ----------

  function buildWhere(dataset, filterValues) {
    var clauses = [];
    (dataset.columns || []).forEach(function (col) {
      var v = filterValues[col.name];
      if (v === undefined || v === null) return;
      if (col.filter === "select") {
        if (v !== "") clauses.push(quoteIdent(col.name) + " = " + quoteLiteral(v));
      } else if (col.filter === "text") {
        if (String(v).trim() !== "") {
          clauses.push(quoteIdent(col.name) + " ILIKE " + quoteLiteral("%" + String(v).trim() + "%"));
        }
      } else if (col.filter === "range") {
        var min = v.min, max = v.max;
        if (min !== undefined && min !== "") clauses.push(quoteIdent(col.name) + " >= " + Number(min));
        if (max !== undefined && max !== "") clauses.push(quoteIdent(col.name) + " <= " + Number(max));
      } else if (col.filter === "boolean") {
        if (v === "true") clauses.push(quoteIdent(col.name) + " = TRUE");
        else if (v === "false") clauses.push(quoteIdent(col.name) + " = FALSE");
      }
    });
    return clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  }

  function defaultFiltersFor(dataset) {
    var out = {};
    (dataset.columns || []).forEach(function (col) {
      if (col.filter === "range") out[col.name] = { min: "", max: "" };
      else if (col.filter) out[col.name] = "";
    });
    return out;
  }

  // ---------- filter components ----------

  function FilterSelect(props) {
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("select", {
        value: props.value || "",
        onChange: function (e) { props.onChange(e.target.value); }
      },
        h("option", { value: "" }, "All"),
        (props.options || []).map(function (opt) {
          var s = opt === null || opt === undefined ? "" : String(opt);
          return h("option", { key: s, value: s }, s);
        })
      )
    );
  }

  function FilterText(props) {
    var [local, setLocal] = useState(props.value || "");
    useEffect(function () { setLocal(props.value || ""); }, [props.value]);
    useEffect(function () {
      var t = setTimeout(function () {
        if (local !== (props.value || "")) props.onChange(local);
      }, TEXT_DEBOUNCE_MS);
      return function () { clearTimeout(t); };
    }, [local]);
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("input", {
        value: local,
        placeholder: "Search…",
        onChange: function (e) { setLocal(e.target.value); }
      })
    );
  }

  function FilterRange(props) {
    var v = props.value || { min: "", max: "" };
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("div", { className: "range-row" },
        h("input", {
          type: "number", value: v.min, placeholder: "Min",
          onChange: function (e) { props.onChange({ min: e.target.value, max: v.max }); }
        }),
        h("input", {
          type: "number", value: v.max, placeholder: "Max",
          onChange: function (e) { props.onChange({ min: v.min, max: e.target.value }); }
        })
      )
    );
  }

  function FilterBoolean(props) {
    return h("div", { className: "filter-block" },
      h("label", null, props.label),
      h("select", {
        value: props.value || "",
        onChange: function (e) { props.onChange(e.target.value); }
      },
        h("option", { value: "" }, "All"),
        h("option", { value: "true" }, "True"),
        h("option", { value: "false" }, "False")
      )
    );
  }

  // ---------- sidebar / tabs / table ----------

  function Sidebar(props) {
    var dataset = props.dataset;
    var filters = props.filters;
    var options = props.options;

    var filterCols = (dataset.columns || []).filter(function (c) { return c.filter; });

    return h("aside", { className: "sidebar" },
      h("div", { className: "sidebar-header" },
        h("h1", null, props.appTitle || "Data Viewer"),
        h("div", { className: "subtitle" }, dataset.label || dataset.id)
      ),
      h("div", { className: "filter-list" },
        filterCols.length === 0
          ? h("div", { className: "empty-state", style: { padding: "20px 0" } },
              "No filters configured for this dataset.")
          : filterCols.map(function (col) {
              var label = col.label || col.name;
              if (col.filter === "select") {
                return h(FilterSelect, {
                  key: col.name, label: label,
                  value: filters[col.name],
                  options: options[col.name] || [],
                  onChange: function (v) { props.onFilter(col.name, v); }
                });
              }
              if (col.filter === "text") {
                return h(FilterText, {
                  key: col.name, label: label,
                  value: filters[col.name],
                  onChange: function (v) { props.onFilter(col.name, v); }
                });
              }
              if (col.filter === "range") {
                return h(FilterRange, {
                  key: col.name, label: label,
                  value: filters[col.name],
                  onChange: function (v) { props.onFilter(col.name, v); }
                });
              }
              if (col.filter === "boolean") {
                return h(FilterBoolean, {
                  key: col.name, label: label,
                  value: filters[col.name],
                  onChange: function (v) { props.onFilter(col.name, v); }
                });
              }
              return null;
            })
      ),
      h("div", { className: "sidebar-actions" },
        h("button", { onClick: props.onReset }, "Reset"),
        h("button", {
          className: "primary",
          onClick: props.onExport, disabled: props.exporting
        }, props.exporting ? "Exporting…" : "Export CSV")
      )
    );
  }

  function TabBar(props) {
    if (props.datasets.length <= 1) return null;
    return h("div", { className: "tab-bar" },
      props.datasets.map(function (ds) {
        return h("button", {
          key: ds.id,
          className: "tab" + (ds.id === props.activeId ? " active" : ""),
          onClick: function () { props.onSelect(ds.id); }
        }, ds.label || ds.id);
      })
    );
  }

  function DataTable(props) {
    var schema = props.schema;
    var totalPages = Math.max(1, Math.ceil(props.totalRows / PAGE_SIZE));
    var labelMap = props.labelMap || {};

    function sortIndicator(col) {
      if (props.sort.col !== col) return "";
      return props.sort.dir === "ASC" ? " ▲" : " ▼";
    }

    return h("section", { className: "table-panel" },
      h("div", { className: "table-toolbar" },
        h("h2", null, "Raw Data"),
        h("div", { className: "table-toolbar-actions" },
          h("div", { className: props.error ? "status error" : "status" }, props.status || "")
        )
      ),
      h("div", { className: "table-wrap" },
        props.rows.length === 0
          ? h("div", { className: "empty-state" }, "No rows match the current filters.")
          : h("table", null,
              h("thead", null,
                h("tr", null, schema.map(function (s) {
                  var label = labelMap[s.name] || s.name;
                  return h("th", {
                    key: s.name,
                    className: isNumericType(s.type) ? "numeric" : "",
                    onClick: function () { props.onSort(s.name); }
                  },
                    label,
                    h("span", { className: "sort-indicator" }, sortIndicator(s.name))
                  );
                }))
              ),
              h("tbody", null, props.rows.map(function (row, idx) {
                return h("tr", { key: idx }, schema.map(function (s) {
                  var v = row[s.name];
                  var text = isNumericType(s.type) && v !== null && v !== undefined && !(v instanceof Date)
                    ? formatNumber(v)
                    : normalizeCell(v);
                  return h("td", { key: s.name, className: isNumericType(s.type) ? "numeric" : "" }, text);
                }));
              }))
            )
      ),
      h("div", { className: "pager" },
        h("div", null,
          "Page " + (props.page + 1) + " of " + formatNumber(totalPages) +
          " · " + formatNumber(props.totalRows) + " rows"),
        h("div", { className: "pager-buttons" },
          h("button", { onClick: function () { props.onPage(0); }, disabled: props.page === 0 }, "First"),
          h("button", { onClick: function () { props.onPage(Math.max(0, props.page - 1)); }, disabled: props.page === 0 }, "Prev"),
          h("button", { onClick: function () { props.onPage(Math.min(totalPages - 1, props.page + 1)); }, disabled: props.page >= totalPages - 1 }, "Next")
        )
      )
    );
  }

  // ---------- App ----------

  function defaultDatasetState(dataset, schema) {
    return {
      filters: defaultFiltersFor(dataset),
      sort: { col: schema[0] ? schema[0].name : null, dir: "ASC" },
      page: 0
    };
  }

  function App(props) {
    var config = props.config;
    var dbRef = useRef(null);
    var querySeq = useRef(0);

    var [ready, setReady] = useState(false);
    var [initError, setInitError] = useState("");
    var [activeId, setActiveId] = useState(config.datasets[0].id);
    var [meta, setMeta] = useState({});       // { id: { schema, options } }
    var [perDataset, setPerDataset] = useState({});  // { id: { filters, sort, page } }
    var [rows, setRows] = useState([]);
    var [totalRows, setTotalRows] = useState(0);
    var [status, setStatus] = useState("Loading…");
    var [error, setError] = useState("");
    var [exporting, setExporting] = useState(false);

    // Bootstrap: init DuckDB, describe each dataset, validate config, prep state
    useEffect(function () {
      var cancelled = false;
      async function boot() {
        try {
          var db = await initDuckDB(config.datasets);
          if (cancelled) return;
          dbRef.current = db;

          var nextMeta = {};
          var nextState = {};
          for (var i = 0; i < config.datasets.length; i += 1) {
            var ds = config.datasets[i];
            var schema = await describeDataset(db, ds.file);
            validateConfigAgainstSchema(ds, schema);
            var selectCols = (ds.columns || [])
              .filter(function (c) { return c.filter === "select"; })
              .map(function (c) { return c.name; });
            var options = await loadSelectOptions(db, ds.file, selectCols);
            nextMeta[ds.id] = { schema: schema, options: options };
            nextState[ds.id] = defaultDatasetState(ds, schema);
          }
          if (cancelled) return;
          setMeta(nextMeta);
          setPerDataset(nextState);
          setReady(true);
        } catch (err) {
          if (!cancelled) setInitError(err && err.message ? err.message : String(err));
        }
      }
      boot();
      return function () { cancelled = true; };
    }, []);

    var activeDataset = useMemo(function () {
      return config.datasets.find(function (d) { return d.id === activeId; });
    }, [activeId]);
    var activeMeta = meta[activeId];
    var activeState = perDataset[activeId];

    var queryKey = useMemo(function () {
      if (!activeState) return "";
      return activeId + ":" + JSON.stringify(activeState);
    }, [activeId, activeState]);

    // Query on every change to active dataset / its filters / sort / page
    useEffect(function () {
      if (!ready || !dbRef.current || !activeDataset || !activeMeta || !activeState) return;
      var seq = querySeq.current + 1;
      querySeq.current = seq;
      var cancelled = false;
      async function run() {
        setError("");
        setStatus("Querying…");
        try {
          var conn = await dbRef.current.connect();
          var where = buildWhere(activeDataset, activeState.filters);
          var from = baseFrom(activeDataset.file);
          var sortCol = activeState.sort.col;
          var orderBy = sortCol
            ? " ORDER BY " + quoteIdent(sortCol) + " " + activeState.sort.dir + " NULLS LAST"
            : "";
          var countSql = "SELECT COUNT(*) AS n FROM " + from + where;
          var rowsSql = "SELECT * FROM " + from + where + orderBy +
                        " LIMIT " + PAGE_SIZE + " OFFSET " + (activeState.page * PAGE_SIZE);
          var countResult = await conn.query(countSql);
          var rowsResult = await conn.query(rowsSql);
          await conn.close();
          if (cancelled || seq !== querySeq.current) return;

          var total = Number(resultToRows(countResult)[0].n) || 0;
          var rs = resultToRows(rowsResult);
          setTotalRows(total);
          setRows(rs);
          var startRow = activeState.page * PAGE_SIZE + 1;
          var endRow = Math.min(total, activeState.page * PAGE_SIZE + rs.length);
          setStatus(total === 0 ? "No rows" :
            "Showing " + formatNumber(startRow) + "–" + formatNumber(endRow) +
            " of " + formatNumber(total));
        } catch (err) {
          if (cancelled || seq !== querySeq.current) return;
          var msg = err && err.message ? err.message : String(err);
          setError(msg);
          setStatus(msg);
        }
      }
      run();
      return function () { cancelled = true; };
    }, [queryKey, ready]);

    function patchActiveState(patch) {
      setPerDataset(function (prev) {
        var current = prev[activeId] || {};
        var next = Object.assign({}, prev);
        next[activeId] = Object.assign({}, current, patch);
        return next;
      });
    }

    function setFilter(col, value) {
      setPerDataset(function (prev) {
        var current = prev[activeId] || {};
        var nextFilters = Object.assign({}, current.filters);
        nextFilters[col] = value;
        var next = Object.assign({}, prev);
        next[activeId] = Object.assign({}, current, { filters: nextFilters, page: 0 });
        return next;
      });
    }

    function resetFilters() {
      if (!activeDataset || !activeMeta) return;
      patchActiveState({
        filters: defaultFiltersFor(activeDataset),
        page: 0
      });
    }

    function setSort(col) {
      setPerDataset(function (prev) {
        var current = prev[activeId] || {};
        var nextDir = current.sort && current.sort.col === col && current.sort.dir === "ASC" ? "DESC" : "ASC";
        var next = Object.assign({}, prev);
        next[activeId] = Object.assign({}, current, { sort: { col: col, dir: nextDir }, page: 0 });
        return next;
      });
    }

    function setPage(p) { patchActiveState({ page: p }); }

    async function exportCsv() {
      if (!dbRef.current || exporting || !activeDataset || !activeState) return;
      setExporting(true);
      var prevStatus = status;
      setStatus("Preparing CSV export…");
      try {
        var where = buildWhere(activeDataset, activeState.filters);
        var sortCol = activeState.sort.col;
        var orderBy = sortCol
          ? " ORDER BY " + quoteIdent(sortCol) + " " + activeState.sort.dir + " NULLS LAST"
          : "";
        var sql = "SELECT * FROM " + baseFrom(activeDataset.file) + where + orderBy +
                  " LIMIT " + EXPORT_LIMIT;
        await exportQueryToCsv(dbRef.current, activeDataset.id + ".csv", sql);
        setStatus(prevStatus || "");
      } catch (err) {
        var msg = err && err.message ? err.message : String(err);
        setError(msg);
        setStatus(msg);
      } finally {
        setExporting(false);
      }
    }

    if (initError) {
      return h("div", { className: "app-error" },
        h("strong", null, "Unable to load Data Viewer"),
        h("div", null, initError)
      );
    }
    if (!ready || !activeDataset || !activeMeta || !activeState) {
      return h("div", { className: "app-loading" },
        h("div", { className: "spinner" }),
        h("div", null, "Loading DuckDB-WASM and parquet data…")
      );
    }

    var labelMap = {};
    (activeDataset.columns || []).forEach(function (c) {
      if (c.label) labelMap[c.name] = c.label;
    });

    return h("div", { className: "viewer" },
      h(Sidebar, {
        appTitle: config.app_title,
        dataset: activeDataset,
        filters: activeState.filters,
        options: activeMeta.options,
        onFilter: setFilter,
        onReset: resetFilters,
        onExport: exportCsv,
        exporting: exporting
      }),
      h("div", { className: "main" },
        h(TabBar, {
          datasets: config.datasets,
          activeId: activeId,
          onSelect: setActiveId
        }),
        h(DataTable, {
          schema: activeMeta.schema,
          labelMap: labelMap,
          rows: rows,
          totalRows: totalRows,
          page: activeState.page,
          sort: activeState.sort,
          status: status,
          error: error,
          onSort: setSort,
          onPage: setPage
        })
      )
    );
  }

  // ---------- bootstrap ----------

  loadAppConfig()
    .then(function (config) {
      ReactDOM.createRoot(document.getElementById("root")).render(h(App, { config: config }));
    })
    .catch(function (err) {
      console.error("Failed to load app config:", err);
      var root = document.getElementById("root");
      if (root) {
        root.innerHTML = '<div class="app-error"><strong>Failed to load app config</strong>' +
          '<div>' + (err && err.message ? err.message : String(err)) + '</div></div>';
      }
    });
})();

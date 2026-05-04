import Supercluster from "supercluster";
import "../css/styles.css";

(function () {
  "use strict";

  var h = React.createElement;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;

  // Behavior constants (not data-shape — leave hardcoded)
  var PAGE_SIZE = 100;
  var MODAL_PAGE_SIZE = 100;
  var MAP_MARKER_LIMIT = 50000;
  var OUTLET_DOT_RADIUS = 6;
  var CLUSTER_DOT_RADIUS = 10;
  var EXPORT_LIMIT = 1000000;

  // Data-shape constants — populated from public/data/app_config.json by loadAppConfig().
  // Schema fields beyond what's read here (role, label, color_map, expression, ...)
  // are reserved for forward Option B/C evolution and are intentionally inert in A.
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

  function normalizeViewportBounds(bounds) {
    if (!bounds) {
      return null;
    }
    return {
      west: Math.round(Number(bounds.west) * 1000000) / 1000000,
      south: Math.round(Number(bounds.south) * 1000000) / 1000000,
      east: Math.round(Number(bounds.east) * 1000000) / 1000000,
      north: Math.round(Number(bounds.north) * 1000000) / 1000000
    };
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
    var fields = result.schema.fields.map(function (field) {
      return field.name;
    });
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

  function buildCsv(columns, rows) {
    var lines = [columns.map(csvValue).join(",")];
    rows.forEach(function (row) {
      lines.push(columns.map(function (col) {
        return csvValue(row[col]);
      }).join(","));
    });
    return lines.join("\n");
  }

  function downloadCsv(filename, content) {
    var blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

  function buildWhere(filters, tableFilters, viewportBounds) {
    var clauses = ["Lat IS NOT NULL", "Long IS NOT NULL"];

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

    if (viewportBounds) {
      clauses.push("Long >= " + Number(viewportBounds.west));
      clauses.push("Long <= " + Number(viewportBounds.east));
      clauses.push("Lat >= " + Number(viewportBounds.south));
      clauses.push("Lat <= " + Number(viewportBounds.north));
    }

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
        h("h1", null, "Distribution Geo Dashboard"),
        h("div", { className: "subtitle" }, "Account locations and annual sales by region")
      ),
      h("div", { className: "heatmap-controls" },
        h("div", { className: "heatmap-title" }, "County Heatmap"),
        h("label", { className: "check-row" },
          h("input", {
            type: "checkbox",
            checked: props.showCountyHeatmap,
            onChange: function (event) { props.onShowCountyHeatmap(event.target.checked); }
          }),
          h("span", null, "Show county heatmap")
        ),
        h("div", { className: "heatmap-legend" },
          h("div", { className: "legend-gradient" }),
          h("div", { className: "legend-scale" },
            h("span", null, "Low"),
            h("span", null, "High")
          ),
          h("div", { className: "legend-caption" }, "County shading uses total cases from the left-side filters only")
        ),
        h("div", { className: "heatmap-title" }, "Map Boundaries"),
        h("label", { className: "check-row" },
          h("input", {
            type: "checkbox",
            checked: props.showBoundaries,
            onChange: function (event) { props.onShowBoundaries(event.target.checked); }
          }),
          h("span", null, "Show boundaries")
        ),
        h("select", {
          value: props.boundaryLevel,
          disabled: !props.showBoundaries,
          onChange: function (event) { props.onBoundaryLevel(event.target.value); }
        },
          h("option", { value: "state" }, "State boundaries"),
          h("option", { value: "county" }, "County boundaries"),
          h("option", { value: "tract" }, "Tract boundaries")
        )
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

  function MapPanel(props) {
    var mapRef = useRef(null);
    var countyHeatLayerRef = useRef(null);
    var boundaryLayerRef = useRef(null);
    var layerRef = useRef(null);
    var clusterIndexRef = useRef(null);
    var didFitRef = useRef(false);
    var redrawTimerRef = useRef(null);

    function channelColor(channel, fallback) {
      var value = String(channel || "");
      if (value === "Restaurant") return "#c2410c";
      if (value === "Retail") return "#0e7490";
      if (value === "Wholesale") return "#7e22ce";
      return fallback || "#0b8457";
    }

    function popupHtml(point, count) {
      if (count && count > 1) {
        return '<div class="outlet-popup"><strong>' + formatNumber(count, 0) + " accounts</strong>" +
          "Cases 2025: " + formatNumber(point["Cases 2025"]) + "<br>" +
          "Cases 2026: " + formatNumber(point["Cases 2026"]) + "</div>";
      }
      return '<div class="outlet-popup"><strong>' + normalizeCell(point["Account Code"]) + "</strong>" +
        "Geo: " + normalizeCell(point["County Name"]) + ", " + normalizeCell(point["State Name"]) + "<br>" +
        "State: " + normalizeCell(point.State) + "<br>" +
        "Channel: " + normalizeCell(point.Channel) + "<br>" +
        "Cases 2025: " + formatNumber(point["Cases 2025"]) + "<br>" +
        "Cases 2026: " + formatNumber(point["Cases 2026"]) + "</div>";
    }

    function boundaryStyle(feature) {
      var level = feature && feature.properties && feature.properties.GEOID ? "tract" :
        feature && feature.properties && feature.properties["County GEOID"] ? "county" : "state";
      if (level === "tract") {
        return { color: "#334155", weight: 0.7, opacity: 0.55, fillOpacity: 0 };
      }
      if (level === "county") {
        return { color: "#0f766e", weight: 1.1, opacity: 0.7, fillOpacity: 0 };
      }
      return { color: "#111827", weight: 1.8, opacity: 0.78, fillOpacity: 0 };
    }

    function countyHeatColor(total, minTotal, maxTotal) {
      if (!(total > 0) || !(maxTotal > 0)) {
        return "#7f1d1d";
      }
      if (!(minTotal > 0) || minTotal >= maxTotal) {
        return "#0b6e4f";
      }
      var logMin = Math.log1p(minTotal);
      var logMax = Math.log1p(maxTotal);
      var ratio = Math.max(0, Math.min(1, (Math.log1p(total) - logMin) / (logMax - logMin)));
      if (ratio >= 0.92) {
        return "#0b6e4f";
      }
      if (ratio >= 0.78) {
        return "#198754";
      }
      if (ratio >= 0.62) {
        return "#52b788";
      }
      if (ratio >= 0.46) {
        return "#7fbc8c";
      }
      if (ratio >= 0.3) {
        return "#8f6f63";
      }
      if (ratio >= 0.14) {
        return "#7b3f3f";
      }
      return "#5f0f0f";
    }

    function countyHeatStyle(feature) {
      var heat = (feature.properties || {}).heat || {};
      var total = Number(heat["Total Cases"]) || 0;
      var minTotal = Number(props.countyHeatMin) || 0;
      var maxTotal = Number(props.countyHeatMax) || 0;
      return {
        color: "#6b7280",
        weight: 0.6,
        opacity: props.showCountyHeatmap ? 0.35 : 0,
        fillColor: countyHeatColor(total, minTotal, maxTotal),
        fillOpacity: props.showCountyHeatmap && total > 0 ? 0.7 : 0
      };
    }

    function boundaryPopup(feature, layer) {
      var props = feature.properties || {};
      var title = props["Tract Name"] || props["County Name"] || props["State Name"] || "Boundary";
      var detail = "";
      if (props["County Name"] && props["State Name"] && props["Tract Name"]) {
        detail = props["County Name"] + ", " + props["State Name"] + "<br>GEOID: " + props.GEOID;
      } else if (props["County Name"] && props["State Name"]) {
        detail = props["County Name"] + ", " + props["State Name"];
      } else if (props["State Name"]) {
        detail = props["State Name"];
      }
      layer.bindPopup('<div class="outlet-popup"><strong>' + normalizeCell(title) + "</strong>" + detail + "</div>");
    }

    function countyHeatPopup(feature, layer) {
      var props = feature.properties || {};
      var heat = props.heat || {};
      layer.bindPopup(
        '<div class="outlet-popup"><strong>' + normalizeCell(props["County Name"]) + ", " + normalizeCell(props["State Name"]) + "</strong>" +
        "Cases 2024: " + formatNumber(heat["Cases 2024"]) + "<br>" +
        "Cases 2025: " + formatNumber(heat["Cases 2025"]) + "<br>" +
        "Cases 2026: " + formatNumber(heat["Cases 2026"]) + "<br>" +
        "Total Cases: " + formatNumber(heat["Total Cases"]) + "<br>" +
        "Outlets: " + formatNumber(heat.outlets, 0) + "</div>"
      );
    }

    function buildClusterIndex(points) {
      var features = [];
      points.forEach(function (point) {
        var lat = Number(point.Lat);
        var lng = Number(point.Long);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return;
        }
        var channel = String(point.Channel || "");
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lng, lat]
          },
          properties: Object.assign({}, point, {
            Count: 1,
            ChannelRestaurant: channel === "Restaurant" ? 1 : 0,
            ChannelRetail: channel === "Retail" ? 1 : 0,
            ChannelWholesale: channel === "Wholesale" ? 1 : 0,
            "Cases 2025": Number(point["Cases 2025"]) || 0,
            "Cases 2026": Number(point["Cases 2026"]) || 0
          })
        });
      });

      clusterIndexRef.current = new Supercluster({
        radius: 84,
        extent: 512,
        maxZoom: 12,
        minPoints: 4,
        map: function (props) {
          return {
            Count: Number(props.Count) || 1,
            ChannelRestaurant: Number(props.ChannelRestaurant) || 0,
            ChannelRetail: Number(props.ChannelRetail) || 0,
            ChannelWholesale: Number(props.ChannelWholesale) || 0,
            "Cases 2025": Number(props["Cases 2025"]) || 0,
            "Cases 2026": Number(props["Cases 2026"]) || 0
          };
        },
        reduce: function (accumulated, props) {
          accumulated.Count += Number(props.Count) || 0;
          accumulated.ChannelRestaurant += Number(props.ChannelRestaurant) || 0;
          accumulated.ChannelRetail += Number(props.ChannelRetail) || 0;
          accumulated.ChannelWholesale += Number(props.ChannelWholesale) || 0;
          accumulated["Cases 2025"] += Number(props["Cases 2025"]) || 0;
          accumulated["Cases 2026"] += Number(props["Cases 2026"]) || 0;
        }
      }).load(features);
    }

    function renderMapPoints() {
      if (!mapRef.current || !layerRef.current || !clusterIndexRef.current) {
        return;
      }

      var map = mapRef.current;
      var zoom = Math.round(map.getZoom());
      var bounds = map.getBounds();
      var bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth()
      ];
      var clusters = clusterIndexRef.current.getClusters(bbox, zoom);
      layerRef.current.clearLayers();

      clusters.forEach(function (feature) {
        var coordinates = feature.geometry.coordinates;
        var point = Object.assign({}, feature.properties, {
          Long: coordinates[0],
          Lat: coordinates[1],
          Count: feature.properties.cluster ? feature.properties.point_count : 1
        });
        var count = Number(point.Count) || Number(feature.properties.point_count) || 1;
        var isCluster = count > 1;
        var dominantChannel = point.Channel;
        if (!dominantChannel) {
          var counts = [
            ["Restaurant", Number(point.ChannelRestaurant) || 0],
            ["Retail", Number(point.ChannelRetail) || 0],
            ["Wholesale", Number(point.ChannelWholesale) || 0]
          ];
          counts.sort(function (a, b) { return b[1] - a[1]; });
          dominantChannel = counts[0][1] > 0 ? counts[0][0] : "";
        }
        var color = channelColor(dominantChannel, "#0e7490");
        var radius = isCluster ? CLUSTER_DOT_RADIUS : OUTLET_DOT_RADIUS;
        var marker = L.circleMarker([Number(point.Lat), Number(point.Long)], {
          radius: radius,
          color: color,
          weight: isCluster ? 2.4 : 2,
          opacity: 0.98,
          fillColor: color,
          fillOpacity: isCluster ? 0.6 : 0.92
        });
        marker.bindPopup(popupHtml(point, count));
        marker.addTo(layerRef.current);

        if (isCluster && zoom <= 12) {
          L.marker([Number(point.Lat), Number(point.Long)], {
            interactive: false,
            icon: L.divIcon({
              className: "cluster-count",
              html: formatNumber(count, 0),
              iconSize: [42, 18],
              iconAnchor: [21, 9]
            })
          }).addTo(layerRef.current);
        }
      });
    }

    function scheduleRenderMapPoints() {
      if (redrawTimerRef.current) {
        clearTimeout(redrawTimerRef.current);
      }
      redrawTimerRef.current = setTimeout(renderMapPoints, 70);
    }

    function emitViewportChange() {
      if (!mapRef.current || !props.onViewportChange) {
        return;
      }
      var bounds = mapRef.current.getBounds();
      props.onViewportChange({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth()
      });
    }

    useEffect(function () {
      if (!mapRef.current) {
        mapRef.current = L.map("map", { preferCanvas: true, zoomControl: true }).setView([39.5, -98.35], 4);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          opacity: 0.34,
          className: "basemap-muted",
          attribution: "&copy; OpenStreetMap contributors"
        }).addTo(mapRef.current);
        mapRef.current.createPane("countyHeatPane");
        mapRef.current.getPane("countyHeatPane").style.zIndex = 350;
        countyHeatLayerRef.current = L.geoJSON(null, {
          pane: "countyHeatPane",
          style: countyHeatStyle,
          onEachFeature: countyHeatPopup
        }).addTo(mapRef.current);
        boundaryLayerRef.current = L.geoJSON(null, {
          style: boundaryStyle,
          onEachFeature: boundaryPopup
        }).addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
        mapRef.current.on("zoomend moveend", function () {
          scheduleRenderMapPoints();
          emitViewportChange();
        });
      }
      setTimeout(function () {
        mapRef.current.invalidateSize();
      }, 50);
      return function () {
        if (redrawTimerRef.current) {
          clearTimeout(redrawTimerRef.current);
        }
      };
    }, []);

    useEffect(function () {
      if (!mapRef.current || !layerRef.current) {
        return;
      }
      buildClusterIndex(props.points);
      var bounds = [];
      props.points.forEach(function (point) {
        var lat = Number(point.Lat);
        var lng = Number(point.Long);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return;
        }
        bounds.push([lat, lng]);
      });
      renderMapPoints();
      if (bounds.length > 0 && !didFitRef.current) {
        mapRef.current.fitBounds(bounds, { padding: [26, 26], maxZoom: 12 });
        didFitRef.current = true;
      }
    }, [props.points]);

    useEffect(function () {
      if (!countyHeatLayerRef.current) {
        return;
      }
      countyHeatLayerRef.current.clearLayers();
      if (props.countyHeatFeatures && props.countyHeatFeatures.features && props.countyHeatFeatures.features.length) {
        countyHeatLayerRef.current.addData(props.countyHeatFeatures);
        countyHeatLayerRef.current.eachLayer(function (layer) {
          if (layer.setStyle && layer.feature) {
            layer.setStyle(countyHeatStyle(layer.feature));
          }
        });
        countyHeatLayerRef.current.bringToBack();
        if (boundaryLayerRef.current) {
          boundaryLayerRef.current.bringToFront();
        }
        if (layerRef.current && layerRef.current.eachLayer) {
          layerRef.current.eachLayer(function (layer) {
            if (layer && layer.bringToFront) {
              layer.bringToFront();
            }
          });
        }
      }
    }, [props.countyHeatFeatures, props.countyHeatMax, props.showCountyHeatmap]);

    useEffect(function () {
      if (!boundaryLayerRef.current) {
        return;
      }
      boundaryLayerRef.current.clearLayers();
      if (props.boundaryFeatures && props.boundaryFeatures.features && props.boundaryFeatures.features.length) {
        boundaryLayerRef.current.addData(props.boundaryFeatures);
      }
    }, [props.boundaryFeatures]);

    return h("section", { className: "map-panel" },
      h("div", { className: "toolbar" },
        h("div", { className: "metric-row" },
          h("div", { className: "metric" }, h("span", { className: "label" }, "Accounts"), formatNumber(props.metrics.outlets, 0)),
          h("div", { className: "metric" }, h("span", { className: "label" }, "Rows"), formatNumber(props.metrics.rows, 0)),
          h("div", { className: "metric" }, h("span", { className: "label" }, "Cases 2025"), formatNumber(props.metrics.fy25)),
          h("div", { className: "metric" }, h("span", { className: "label" }, "Cases 2026"), formatNumber(props.metrics.fy26)),
          h("div", { className: "map-legend" },
            h("span", { className: "legend-item" }, h("span", { className: "legend-dot restaurant" }), "Restaurant"),
            h("span", { className: "legend-item" }, h("span", { className: "legend-dot retail" }), "Retail"),
            h("span", { className: "legend-item" }, h("span", { className: "legend-dot wholesale" }), "Wholesale")
          )
        ),
        h("div", { className: props.error ? "status error" : "status" },
          props.status,
          props.boundaryStatus ? h("span", { className: "boundary-status" }, " · " + props.boundaryStatus) : null
        )
      ),
      h("div", { id: "map" })
    );
  }

  function DataTable(props) {
    var totalPages = Math.max(1, Math.ceil(props.totalRows / PAGE_SIZE));
    var activeFilterColState = useState(null);
    var activeFilterCol = activeFilterColState[0];
    var setActiveFilterCol = activeFilterColState[1];

    function sortLabel(col) {
      if (props.sort.col !== col) {
        return col;
      }
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
      if (activeFilterCol !== col) {
        return null;
      }

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
        if (col === COLUMNS[0]) {
          return h("th", { key: col }, label);
        }
        if (!NUMERIC_COLUMNS[col]) {
          return h("th", { key: col }, "");
        }
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
          }, props.exporting ? "Exporting..." : "Export CSV"),
          h("button", { type: "button", onClick: props.onToggleCollapse }, "Collapse")
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
                ));
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
    var countyBoundarySourceRef = useRef(null);
    var contentRef = useRef(null);
    var mapQuerySeq = useRef(0);
    var tableQuerySeq = useRef(0);
    var viewportDebounceRef = useRef(null);
    var tableDragRef = useRef(null);
    var [ready, setReady] = useState(false);
    var [initError, setInitError] = useState("");
    var [options, setOptions] = useState({
      geoStates: [],
      counties: [],
      states: [],
      channels: [],
      visitationPriorities: [],
      brands: [],
      variants: [],
      sizes: [],
      table: {}
    });
    var [filters, setFilters] = useState(defaultFilters());
    var [tableFilters, setTableFilters] = useState({});
    var [sort, setSort] = useState({ col: "Cases 2026", dir: "DESC" });
    var [page, setPage] = useState(0);
    var [points, setPoints] = useState([]);
    var [countyHeatRows, setCountyHeatRows] = useState([]);
    var [countyHeatFeatures, setCountyHeatFeatures] = useState(null);
    var [countyHeatMin, setCountyHeatMin] = useState(0);
    var [countyHeatMax, setCountyHeatMax] = useState(0);
    var [boundarySelection, setBoundarySelection] = useState({ stateFips: [], countyGeoIds: [], geoIds: [] });
    var [boundaryFeatures, setBoundaryFeatures] = useState(null);
    var [boundaryLevel, setBoundaryLevel] = useState("county");
    var [showCountyHeatmap, setShowCountyHeatmap] = useState(true);
    var [showBoundaries, setShowBoundaries] = useState(true);
    var [boundaryStatus, setBoundaryStatus] = useState("Loading boundaries...");
    var [rows, setRows] = useState([]);
    var [metrics, setMetrics] = useState({ outlets: 0, rows: 0, fy25: 0, fy26: 0 });
    var [viewportBounds, setViewportBounds] = useState(null);
    var [tableTotalRows, setTableTotalRows] = useState(0);
    var [tableSummary, setTableSummary] = useState({});
    var [mapStatus, setMapStatus] = useState("Loading map data...");
    var [tableStatus, setTableStatus] = useState("Loading table...");
    var [queryError, setQueryError] = useState("");
    var [exporting, setExporting] = useState(false);
    var [tablePanelHeight, setTablePanelHeight] = useState(360);
    var [tablePanelCollapsed, setTablePanelCollapsed] = useState(false);

    var SPLITTER_HEIGHT = 12;
    var MIN_TABLE_HEIGHT = 180;
    var COLLAPSED_TABLE_HEIGHT = 0;

    useEffect(function () {
      var cancelled = false;
      async function boot() {
        try {
          var db = await initDuckDB();
          if (cancelled) {
            return;
          }
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
            return {
              value: row["County GEOID"],
              label: row["County Name"] + ", " + row["State Name"]
            };
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
      return function () {
        cancelled = true;
      };
    }, []);

    useEffect(function () {
      return function () {
        if (viewportDebounceRef.current) {
          clearTimeout(viewportDebounceRef.current);
        }
      };
    }, []);

    useEffect(function () {
      return function () {
        if (tableDragRef.current && tableDragRef.current.cleanup) {
          tableDragRef.current.cleanup();
        }
      };
    }, []);

    var mapFilterKey = useMemo(function () {
      return JSON.stringify({
        filters: filters
      });
    }, [filters]);

    var tableFilterKey = useMemo(function () {
      return JSON.stringify({
        filters: filters,
        tableFilters: tableFilters,
        sort: sort,
        page: page,
        viewportBounds: normalizeViewportBounds(viewportBounds)
      });
    }, [filters, tableFilters, sort, page, viewportBounds]);

    var boundaryKey = useMemo(function () {
      return JSON.stringify({
        level: boundaryLevel,
        show: showBoundaries,
        geoState: filters.geoState,
        countyGeoId: filters.countyGeoId,
        stateFips: boundarySelection.stateFips,
        countyGeoIds: boundarySelection.countyGeoIds,
        geoIds: boundarySelection.geoIds
      });
    }, [boundaryLevel, showBoundaries, filters.geoState, filters.countyGeoId, boundarySelection]);

    useEffect(function () {
      if (!ready || !dbRef.current) {
        return;
      }
      var seq = mapQuerySeq.current + 1;
      mapQuerySeq.current = seq;
      var cancelled = false;
      async function runMapQueries() {
        setQueryError("");
        setMapStatus("Querying selected outlets...");
        try {
          var conn = await dbRef.current.connect();
          var sidebarWhere = buildWhere(filters);
          var metricsSql =
            "SELECT COUNT(*) AS rows, COUNT(DISTINCT " + quoteIdent("Account Code") + ") AS outlets, " +
            "SUM(" + quoteIdent("Cases 2025") + ") AS fy25, SUM(" + quoteIdent("Cases 2026") + ") AS fy26 " +
            "FROM " + baseFrom() + sidebarWhere;
          var mapSql =
            "SELECT " + quoteIdent("Account Code") + ", any_value(State) AS State, any_value(" + quoteIdent("State Name") + ") AS " + quoteIdent("State Name") + ", " +
            "any_value(" + quoteIdent("County Name") + ") AS " + quoteIdent("County Name") + ", any_value(Channel) AS Channel, any_value(GeoID) AS GeoID, " +
            "avg(Lat) AS Lat, avg(Long) AS Long, SUM(" + quoteIdent("Cases 2025") + ") AS " + quoteIdent("Cases 2025") + ", " +
            "SUM(" + quoteIdent("Cases 2026") + ") AS " + quoteIdent("Cases 2026") + " " +
            "FROM " + baseFrom() + sidebarWhere + " GROUP BY " + quoteIdent("Account Code") + " " +
            "ORDER BY " + quoteIdent("Cases 2026") + " DESC LIMIT " + MAP_MARKER_LIMIT;
          var countyHeatSql =
            "SELECT " + quoteIdent("County GEOID") + ", " +
            "any_value(" + quoteIdent("County Name") + ") AS " + quoteIdent("County Name") + ", " +
            "any_value(" + quoteIdent("State Name") + ") AS " + quoteIdent("State Name") + ", " +
            "COUNT(DISTINCT " + quoteIdent("Account Code") + ") AS outlets, " +
            "SUM(" + quoteIdent("Cases 2024") + ") AS " + quoteIdent("Cases 2024") + ", " +
            "SUM(" + quoteIdent("Cases 2025") + ") AS " + quoteIdent("Cases 2025") + ", " +
            "SUM(" + quoteIdent("Cases 2026") + ") AS " + quoteIdent("Cases 2026") + ", " +
            "SUM(" + quoteIdent("Cases 2024") + " + " + quoteIdent("Cases 2025") + " + " + quoteIdent("Cases 2026") + ") AS " + quoteIdent("Total Cases") + " " +
            "FROM " + baseFrom() + sidebarWhere + " AND " + quoteIdent("County GEOID") + " IS NOT NULL " +
            " GROUP BY " + quoteIdent("County GEOID");
          var boundarySql =
            "SELECT " + quoteIdent("State FIPS") + ", " + quoteIdent("County GEOID") + ", GeoID " +
            "FROM " + baseFrom() + sidebarWhere + " GROUP BY " + quoteIdent("State FIPS") + ", " + quoteIdent("County GEOID") + ", GeoID";

          var metricsResult = await conn.query(metricsSql);
          var mapResult = await conn.query(mapSql);
          var countyHeatResult = await conn.query(countyHeatSql);
          var boundaryResult = await conn.query(boundarySql);
          await conn.close();

          if (cancelled || seq !== mapQuerySeq.current) {
            return;
          }

          var metricRows = resultToRows(metricsResult);
          var metric = metricRows[0] || {};
          var outletCount = Number(metric.outlets || 0);
          var pointRows = resultToRows(mapResult);
          var countyHeatData = resultToRows(countyHeatResult);
          var boundaryRows = resultToRows(boundaryResult);

          setMetrics({
            outlets: outletCount,
            rows: Number(metric.rows || 0),
            fy25: Number(metric.fy25 || 0),
            fy26: Number(metric.fy26 || 0)
          });
          setPoints(pointRows);
          setCountyHeatRows(countyHeatData);
          var positiveTotals = countyHeatData.map(function (row) {
            return Number(row["Total Cases"]) || 0;
          }).filter(function (value) {
            return value > 0;
          });
          setCountyHeatMin(positiveTotals.length ? Math.min.apply(null, positiveTotals) : 0);
          setCountyHeatMax(countyHeatData.reduce(function (maxValue, row) {
            return Math.max(maxValue, Number(row["Total Cases"]) || 0);
          }, 0));
          setBoundarySelection({
            stateFips: Array.from(new Set(boundaryRows.map(function (row) { return row["State FIPS"]; }).filter(Boolean))),
            countyGeoIds: Array.from(new Set(boundaryRows.map(function (row) { return row["County GEOID"]; }).filter(Boolean))),
            geoIds: Array.from(new Set(boundaryRows.map(function (row) { return row.GeoID; }).filter(Boolean)))
          });
          setMapStatus(pointRows.length < outletCount
            ? "Showing top " + formatNumber(pointRows.length, 0) + " of " + formatNumber(outletCount, 0) + " outlets by Cases 2026"
            : "Showing " + formatNumber(pointRows.length, 0) + " selected outlets");
        } catch (err) {
          if (cancelled || seq !== mapQuerySeq.current) {
            return;
          }
          var message = err && err.message ? err.message : String(err);
          setQueryError(message);
          setMapStatus(message);
        }
      }
      runMapQueries();
      return function () {
        cancelled = true;
      };
    }, [ready, mapFilterKey]);

    useEffect(function () {
      if (!ready || !dbRef.current) {
        return;
      }
      var seq = tableQuerySeq.current + 1;
      tableQuerySeq.current = seq;
      var cancelled = false;
      async function runTableQueries() {
        setQueryError("");
        setTableStatus("Querying outlet details...");
        try {
          var conn = await dbRef.current.connect();
          var tableWhere = buildWhere(filters, tableFilters, viewportBounds);
          var countSql = "SELECT COUNT(*) AS total_rows FROM " + baseFrom() + tableWhere;
          var summarySql =
            "SELECT " +
            Object.keys(NUMERIC_COLUMNS).map(function (col) {
              return [
                "SUM(" + quoteIdent(col) + ") AS " + quoteIdent(col + "__sum"),
                "COUNT(" + quoteIdent(col) + ") AS " + quoteIdent(col + "__count"),
                "AVG(" + quoteIdent(col) + ") AS " + quoteIdent(col + "__avg")
              ].join(", ");
            }).join(", ") +
            " FROM " + baseFrom() + tableWhere;
          var orderSql = " ORDER BY " + quoteIdent(sort.col) + " " + sort.dir + " NULLS LAST";
          var tableSql = "SELECT " + COLUMNS.map(quoteIdent).join(", ") + " FROM " + baseFrom() + tableWhere + orderSql + " LIMIT " + PAGE_SIZE + " OFFSET " + (page * PAGE_SIZE);
          var countResult = await conn.query(countSql);
          var summaryResult = await conn.query(summarySql);
          var tableResult = await conn.query(tableSql);
          await conn.close();

          if (cancelled || seq !== tableQuerySeq.current) {
            return;
          }

          var totalRows = Number(resultToRows(countResult)[0].total_rows || 0);
          var summaryRow = resultToRows(summaryResult)[0] || {};
          var nextSummary = {};
          Object.keys(NUMERIC_COLUMNS).forEach(function (col) {
            nextSummary[col] = {
              sum: Number(summaryRow[col + "__sum"]) || 0,
              count: Number(summaryRow[col + "__count"]) || 0,
              avg: Number(summaryRow[col + "__avg"]) || 0
            };
          });
          setTableTotalRows(totalRows);
          setTableSummary(nextSummary);
          setRows(resultToRows(tableResult));
          setTableStatus("Showing " + formatNumber(Math.max(0, Math.min(PAGE_SIZE, totalRows - page * PAGE_SIZE)), 0) + " of " + formatNumber(totalRows, 0) + " detail rows");
        } catch (err) {
          if (cancelled || seq !== tableQuerySeq.current) {
            return;
          }
          var message = err && err.message ? err.message : String(err);
          setQueryError(message);
          setTableStatus(message);
        }
      }
      runTableQueries();
      return function () {
        cancelled = true;
      };
    }, [ready, tableFilterKey]);

    useEffect(function () {
      if (!ready) {
        return;
      }
      var cancelled = false;

      function selectedSet(values) {
        var set = {};
        (values || []).forEach(function (value) {
          if (value) {
            set[String(value)] = true;
          }
        });
        return set;
      }

      function filterFeatureCollection(collection, propertyName, allowedValues) {
        var allowed = selectedSet(allowedValues);
        var keys = Object.keys(allowed);
        if (!keys.length) {
          return { type: "FeatureCollection", features: [] };
        }
        return {
          type: "FeatureCollection",
          features: (collection.features || []).filter(function (feature) {
            return allowed[String((feature.properties || {})[propertyName])];
          })
        };
      }

      async function fetchJson(path) {
        var resp = await fetch(path);
        if (!resp.ok) {
          throw new Error("Unable to load " + path);
        }
        return resp.json();
      }

      async function loadBoundaries() {
        if (!showBoundaries) {
          setBoundaryFeatures(null);
          setBoundaryStatus("Boundaries hidden");
          return;
        }
        try {
          setBoundaryStatus("Loading " + boundaryLevel + " boundaries...");
          if (boundaryLevel === "state") {
            var states = await fetchJson("data/boundaries/state_boundaries.geojson");
            if (cancelled) {
              return;
            }
            var stateFeatures = filterFeatureCollection(states, "State FIPS", boundarySelection.stateFips);
            setBoundaryFeatures(stateFeatures);
            setBoundaryStatus(formatNumber(stateFeatures.features.length, 0) + " state boundaries");
            return;
          }

          if (boundaryLevel === "county") {
            var counties = await fetchJson("data/boundaries/county_boundaries.geojson");
            if (cancelled) {
              return;
            }
            var countyFeatures = filterFeatureCollection(counties, "County GEOID", boundarySelection.countyGeoIds);
            setBoundaryFeatures(countyFeatures);
            setBoundaryStatus(formatNumber(countyFeatures.features.length, 0) + " county boundaries");
            return;
          }

          if (boundarySelection.stateFips.length !== 1) {
            setBoundaryFeatures(null);
            setBoundaryStatus("Select one Geo State for tract boundaries");
            return;
          }
          var stateFips = boundarySelection.stateFips[0];
          var tracts = await fetchJson("data/boundaries/tract_boundaries_" + stateFips + ".geojson");
          if (cancelled) {
            return;
          }
          var tractFeatures = filterFeatureCollection(tracts, "GEOID", boundarySelection.geoIds);
          setBoundaryFeatures(tractFeatures);
          setBoundaryStatus(formatNumber(tractFeatures.features.length, 0) + " tract boundaries");
        } catch (err) {
          if (!cancelled) {
            setBoundaryFeatures(null);
            setBoundaryStatus(err && err.message ? err.message : String(err));
          }
        }
      }

      loadBoundaries();
      return function () {
        cancelled = true;
      };
    }, [ready, boundaryKey]);

    useEffect(function () {
      if (!ready) {
        return;
      }
      var cancelled = false;

      async function loadCountyHeatmap() {
        try {
          if (!countyBoundarySourceRef.current) {
            var resp = await fetch("data/boundaries/county_boundaries.geojson");
            if (!resp.ok) {
              throw new Error("Unable to load data/boundaries/county_boundaries.geojson");
            }
            countyBoundarySourceRef.current = await resp.json();
          }
          if (cancelled) {
            return;
          }

          var heatLookup = {};
          countyHeatRows.forEach(function (row) {
            if (row["County GEOID"]) {
              heatLookup[String(row["County GEOID"])] = row;
            }
          });

          var baseCollection = countyBoundarySourceRef.current || { features: [] };
          var features = (baseCollection.features || []).filter(function (feature) {
            var geoid = String((feature.properties || {})["County GEOID"] || "");
            return !!heatLookup[geoid];
          }).map(function (feature) {
            var props = feature.properties || {};
            var geoid = String(props["County GEOID"] || "");
            return {
              type: "Feature",
              geometry: feature.geometry,
              properties: Object.assign({}, props, {
                heat: heatLookup[geoid]
              })
            };
          });

          setCountyHeatFeatures({
            type: "FeatureCollection",
            features: features
          });
        } catch (err) {
          if (!cancelled) {
            setCountyHeatFeatures(null);
            setQueryError(err && err.message ? err.message : String(err));
          }
        }
      }

      loadCountyHeatmap();
      return function () {
        cancelled = true;
      };
    }, [ready, countyHeatRows]);

    function updateFilters(next) {
      setFilters(next);
      setPage(0);
    }

    function updateViewportBounds(nextBounds) {
      var normalized = normalizeViewportBounds(nextBounds);
      if (viewportDebounceRef.current) {
        clearTimeout(viewportDebounceRef.current);
      }
      viewportDebounceRef.current = setTimeout(function () {
        setViewportBounds(function (current) {
          var currentKey = current ? JSON.stringify(current) : "";
          var nextKey = normalized ? JSON.stringify(normalized) : "";
          if (currentKey === nextKey) {
            return current;
          }
          setPage(0);
          return normalized;
        });
      }, 180);
    }

    function updateTableFilter(col, part, value) {
      var next = Object.assign({}, tableFilters);
      if (NUMERIC_COLUMNS[col]) {
        next[col] = Object.assign({}, next[col] || {}, (function () {
          var obj = {};
          obj[part] = value;
          return obj;
        })());
        if (!next[col].min && !next[col].max) {
          delete next[col];
        }
      } else {
        next[col] = value;
        if (!value) {
          delete next[col];
        }
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
      if (!dbRef.current || exporting) {
        return;
      }
      setExporting(true);
      setTableStatus("Preparing CSV export...");
      try {
        var where = buildWhere(filters, tableFilters, viewportBounds);
        var conn = await dbRef.current.connect();
        var countResult = await conn.query("SELECT COUNT(*) AS total_rows FROM " + baseFrom() + where);
        await conn.close();
        var totalRows = Number(resultToRows(countResult)[0].total_rows || 0);
        var sql = "SELECT " + COLUMNS.map(quoteIdent).join(", ") + " FROM " + baseFrom() + where +
          " ORDER BY " + quoteIdent(sort.col) + " " + sort.dir + " NULLS LAST LIMIT " + EXPORT_LIMIT;
        await exportQueryToCsv(dbRef.current, "geo_dashboard_export.csv", sql);
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

    function clampTableHeight(nextHeight) {
      if (!contentRef.current) {
        return Math.max(MIN_TABLE_HEIGHT, nextHeight);
      }
      var rect = contentRef.current.getBoundingClientRect();
      var maxTableHeight = Math.max(MIN_TABLE_HEIGHT, rect.height - 260 - SPLITTER_HEIGHT);
      return Math.max(MIN_TABLE_HEIGHT, Math.min(nextHeight, maxTableHeight));
    }

    function startTableResize(event) {
      if (!contentRef.current) {
        return;
      }
      event.preventDefault();
      if (tablePanelCollapsed) {
        setTablePanelCollapsed(false);
      }
      document.body.classList.add("is-resizing");

      function onMouseMove(moveEvent) {
        if (!contentRef.current) {
          return;
        }
        var rect = contentRef.current.getBoundingClientRect();
        var proposed = rect.bottom - moveEvent.clientY;
        setTablePanelHeight(clampTableHeight(proposed));
      }

      function stopResize() {
        document.body.classList.remove("is-resizing");
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", stopResize);
        tableDragRef.current = null;
      }

      tableDragRef.current = { cleanup: stopResize };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", stopResize);
    }

    function toggleTablePanel() {
      setTablePanelCollapsed(function (current) {
        if (current) {
          setTablePanelHeight(function (height) {
            return clampTableHeight(height || 360);
          });
        }
        return !current;
      });
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

    var contentGridRows = tablePanelCollapsed
      ? "minmax(0, 1fr) " + SPLITTER_HEIGHT + "px " + COLLAPSED_TABLE_HEIGHT + "px"
      : "minmax(0, 1fr) " + SPLITTER_HEIGHT + "px " + tablePanelHeight + "px";

    return h("div", { className: "dashboard" },
        h(Sidebar, {
          filters: filters,
          options: options,
          onChange: updateFilters,
          showCountyHeatmap: showCountyHeatmap,
          onShowCountyHeatmap: setShowCountyHeatmap,
          boundaryLevel: boundaryLevel,
          showBoundaries: showBoundaries,
          onBoundaryLevel: setBoundaryLevel,
          onShowBoundaries: setShowBoundaries,
        onReset: function () {
          setFilters(defaultFilters());
          setTableFilters({});
          setViewportBounds(null);
          setPage(0);
        },
        onExport: exportCsv,
        exporting: exporting
      }),
      h("main", {
        className: "content",
        ref: contentRef,
        style: {
          gridTemplateRows: contentGridRows,
          rowGap: tablePanelCollapsed ? "0px" : "10px"
        }
      },
        h(MapPanel, {
          points: points,
          countyHeatFeatures: countyHeatFeatures,
          countyHeatMin: countyHeatMin,
          countyHeatMax: countyHeatMax,
          showCountyHeatmap: showCountyHeatmap,
          boundaryFeatures: boundaryFeatures,
          metrics: metrics,
          status: mapStatus,
          boundaryStatus: boundaryStatus,
          error: queryError,
          onViewportChange: updateViewportBounds
        }),
        h("div", {
          className: tablePanelCollapsed ? "panel-splitter collapsed" : "panel-splitter",
          onMouseDown: startTableResize
        },
          h("div", { className: "panel-splitter-grip" }),
          h("button", {
            type: "button",
            className: "panel-splitter-toggle",
            onClick: function (event) {
              event.stopPropagation();
              toggleTablePanel();
            }
          }, tablePanelCollapsed ? "Show account details" : "Hide account details")
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
          onToggleCollapse: toggleTablePanel,
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

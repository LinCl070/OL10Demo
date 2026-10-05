import Feature from "ol/Feature";
import Map from "ol/Map";
import Overlay from "ol/Overlay";
import View from "ol/View";
import GeoJSON from "ol/format/GeoJSON";
import KML from "ol/format/KML";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import Draw from "ol/interaction/Draw";
import Select from "ol/interaction/Select";
import Heatmap from "ol/layer/Heatmap";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import Cluster from "ol/source/Cluster";
import TileSource from "ol/source/XYZ";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import { getCenter } from "ol/extent";
import { mapConfig } from "../config/mapConfig";

// 热区只保存可序列化的业务数据，OpenLayers Feature/Overlay 不写入 localStorage。
const HOTSPOT_STORAGE_KEY = "atlas-gis-hotspots-v1";
// 文档示例使用成都兴趣点，作为标注与聚合功能的稳定演示数据。
const sampleMarkers = [
  { name: "天府广场", description: "成都城市中心示例标注", coordinate: [104.0658, 30.6574] },
  { name: "成都东站", description: "交通枢纽示例标注", coordinate: [104.144, 30.6305] },
  { name: "宽窄巷子", description: "历史街区示例标注", coordinate: [104.0557, 30.6714] },
  { name: "熊猫基地", description: "城市景点示例标注", coordinate: [104.146, 30.733] },
  { name: "双流机场", description: "机场示例标注", coordinate: [103.947, 30.578] },
];

// 图文标注和热区共用静态样式；交互状态通过图层的 style 函数切换。
const markerStyle = new Style({
  image: new CircleStyle({ radius: 8, fill: new Fill({ color: "#0b6fae" }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
  text: new Text({ text: "", offsetY: -20, padding: [3, 5, 3, 5], fill: new Fill({ color: "#172331" }), backgroundFill: new Fill({ color: "rgba(255,255,255,0.9)" }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
});
const hotspotStyle = new Style({ fill: new Fill({ color: "rgba(239, 125, 68, 0.25)" }), stroke: new Stroke({ color: "#ef7d44", width: 2 }) });
const hotspotHighlightStyle = new Style({ fill: new Fill({ color: "rgba(239, 125, 68, 0.5)" }), stroke: new Stroke({ color: "#b94722", width: 3 }) });

// 联动面板中的影像地图使用与主地图一致的天地图地址。
const createTileLayer = () => new TileLayer({
  source: new TileSource({
    url: `https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${mapConfig.tiandituKey}`,
    crossOrigin: "anonymous",
  }),
});

export const createChapter7Controller = ({ map, toast }) => {
  // 页面容器由 index.html 提供，控制器只负责填充内容和管理生命周期。
  const panel = document.getElementById("chapter7Panel");
  const panelTitle = document.getElementById("chapter7PanelTitle");
  const panelContent = document.getElementById("chapter7PanelContent");
  const popup = document.getElementById("chapter7Popup");
  const popupContent = document.getElementById("chapter7PopupContent");
  const popupOverlay = new Overlay({ element: popup, positioning: "bottom-center", offset: [0, -12], stopEvent: true, autoPan: { animation: { duration: 180 } } });
  map.addOverlay(popupOverlay);

  // 标注要素同时作为 Cluster 的原始数据源，切换模式时无需重复构造 Feature。
  const markerFeatures = sampleMarkers.map((item) => {
    const feature = new Feature({ geometry: new Point(fromLonLat(item.coordinate)), markerName: item.name, markerDescription: item.description, markerCoordinate: item.coordinate });
    const style = markerStyle.clone();
    style.getText().setText(item.name);
    feature.setStyle(style);
    return feature;
  });
  const markerSource = new VectorSource({ features: markerFeatures });
  const markerLayer = new VectorLayer({ source: markerSource, visible: false });
  map.addLayer(markerLayer);

  // 聚合样式按成员数量缓存，避免地图重绘时反复创建 Style 对象。
  const clusterSource = new Cluster({ distance: 42, source: markerSource });
  const clusterStyleCache = [];
  const clusterLayer = new VectorLayer({
    source: clusterSource,
    visible: false,
    style: (feature) => {
      const count = (feature.get("features") || []).length;
      const cached = clusterStyleCache.find((entry) => entry.count === count);
      if (cached) return cached.style;
      const style = new Style({
        image: new CircleStyle({ radius: count > 1 ? 16 : 10, fill: new Fill({ color: count > 1 ? "#ef7d44" : "#0b6fae" }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
        text: new Text({ text: String(count), fill: new Fill({ color: "#fff" }), font: "bold 12px sans-serif" }),
      });
      clusterStyleCache.push({ count, style });
      return style;
    },
  });
  map.addLayer(clusterLayer);

  const overlayMarkers = [];
  let currentPanelCleanup = () => {};
  let heatmapLayer;
  let hotspotLayer;
  let hotspotSource;
  let hotspotDraw;
  let hotspotSelect;
  let hotspotHover;

  // Popup 使用同一个 Overlay，通过替换 DOM 内容支持标注、聚合和热区详情。
  const closePopup = () => {
    popup.hidden = true;
    popupContent.replaceChildren();
    popupOverlay.setPosition(undefined);
  };
  const showPopup = (feature, coordinate) => {
    const members = feature.get("features");
    const item = members?.length === 1 ? members[0] : feature;
    const name = item.get("markerName") || item.get("name") || "地图要素";
    const description = item.get("markerDescription") || item.get("description") || (members?.length ? `包含 ${members.length} 个标注点` : "示例空间要素");
    const lonlat = item.get("markerCoordinate") || toLonLat(coordinate);
    popupContent.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = name;
    const text = document.createElement("p");
    text.textContent = `${description}（${lonlat[0].toFixed(4)}, ${lonlat[1].toFixed(4)}）`;
    popupContent.append(title, text);
    popup.hidden = false;
    popupOverlay.setPosition(coordinate);
  };
  const mapClickListener = (event) => {
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: (layer) => layer === markerLayer || layer === clusterLayer || layer === hotspotLayer });
    if (feature?.get("features")?.length > 1) closePopup();
    else if (feature) showPopup(feature, event.coordinate);
    else closePopup();
  };
  map.on("singleclick", mapClickListener);

  // 三种标注模式互斥：矢量点、HTML Overlay 或聚合图层只显示一种。
  const setMarkerMode = (mode) => {
    markerLayer.setVisible(mode === "vector");
    clusterLayer.setVisible(false);
    overlayMarkers.forEach((overlay) => map.removeOverlay(overlay));
    overlayMarkers.length = 0;
    if (mode === "overlay") {
      sampleMarkers.forEach((item) => {
        const element = document.createElement("button");
        element.className = "chapter7-marker";
        element.type = "button";
        element.textContent = "●";
        element.title = item.name;
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const feature = markerFeatures.find((candidate) => candidate.get("markerName") === item.name);
          showPopup(feature, fromLonLat(item.coordinate));
        });
        const overlay = new Overlay({ element, position: fromLonLat(item.coordinate), positioning: "bottom-center", offset: [0, -4], stopEvent: true });
        map.addOverlay(overlay);
        overlayMarkers.push(overlay);
      });
    }
  };

  // 面板切换前先执行上一个面板的清理函数，释放临时地图和事件。
  const closePanel = () => {
    currentPanelCleanup();
    currentPanelCleanup = () => {};
    panel.hidden = true;
    panelContent.replaceChildren();
  };
  const openPanel = (title, builder) => {
    closePanel();
    panelTitle.textContent = title;
    panel.hidden = false;
    currentPanelCleanup = builder(panelContent) || (() => {});
  };

  // 启用聚合后，点击多点聚合会 fit 到成员范围；单点继续走 Popup。
  const addClusters = () => {
    setMarkerMode("none");
    clusterLayer.setVisible(true);
    openPanel("聚合标注", (container) => {
      const text = document.createElement("p");
      text.textContent = "点击聚合点可自动放大，聚合展开后可查看单点 Popup。";
      const remove = document.createElement("button");
      remove.className = "action-btn";
      remove.type = "button";
      remove.textContent = "移除聚合标注";
      remove.addEventListener("click", () => { clusterLayer.setVisible(false); closePanel(); toast("已移除聚合标注"); });
      container.append(text, remove);
      return () => {};
    });
    toast("已添加聚合标注");
  };
  const clusterClickListener = (event) => {
    if (!clusterLayer.getVisible()) return;
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: (layer) => layer === clusterLayer });
    if (!feature) return;
    const members = feature.get("features") || [];
    if (members.length > 1) {
      const extent = members[0].getGeometry().getExtent().slice();
      members.slice(1).forEach((item) => { const current = item.getGeometry().getExtent(); extent[0] = Math.min(extent[0], current[0]); extent[1] = Math.min(extent[1], current[1]); extent[2] = Math.max(extent[2], current[2]); extent[3] = Math.max(extent[3], current[3]); });
      map.getView().fit(extent, { duration: 250, padding: [80, 80, 80, 80], maxZoom: 13 });
    } else if (members[0]) showPopup(members[0], feature.getGeometry().getCoordinates());
  };
  map.on("singleclick", clusterClickListener);

  // 投影对照地图使用相同的 GeoJSON，在不同 View projection 下分别解析。
  const createProjectionMap = (target, projection, center) => new Map({
    target,
    layers: [new VectorLayer({ source: new VectorSource({ url: "/province.geojson", format: new GeoJSON({ featureProjection: projection }), wrapX: false }), style: new Style({ fill: new Fill({ color: "rgba(22,133,215,0.08)" }), stroke: new Stroke({ color: "#1685d7", width: 1 }) }) })],
    view: new View({ projection, center, zoom: 4 }),
    controls: [],
  });
  const openProjectionPanel = () => {
    openPanel("投影对照", (container) => {
      const hint = document.createElement("p");
      hint.textContent = "同一省级 GeoJSON 在经纬度坐标与 Web 墨卡托坐标下的显示对照。";
      const maps = document.createElement("div");
      maps.className = "chapter7-mini-maps";
      maps.innerHTML = '<div><strong>EPSG:4326</strong><div id="chapter7Projection4326" class="chapter7-mini-map"></div></div><div><strong>EPSG:3857</strong><div id="chapter7Projection3857" class="chapter7-mini-map"></div></div>';
      container.replaceChildren(hint, maps);
      const map4326 = createProjectionMap("chapter7Projection4326", "EPSG:4326", [104.06, 30.67]);
      const map3857 = createProjectionMap("chapter7Projection3857", "EPSG:3857", fromLonLat([104.06, 30.67]));
      return () => { map4326.setTarget(undefined); map3857.setTarget(undefined); };
    });
  };
  // 两个临时地图共享同一个 View，因此中心、分辨率和旋转状态天然同步。
  const openLinkagePanel = () => {
    openPanel("视图联动", (container) => {
      const hint = document.createElement("p");
      hint.textContent = "两个地图共享同一个 View，拖动和缩放会同步。";
      const maps = document.createElement("div");
      maps.className = "chapter7-mini-maps";
      maps.innerHTML = '<div><strong>Canvas · 矢量</strong><div id="chapter7LinkCanvas" class="chapter7-mini-map"></div></div><div><strong>影像底图</strong><div id="chapter7LinkImage" class="chapter7-mini-map"></div></div>';
      container.replaceChildren(hint, maps);
      const sharedView = new View({ center: fromLonLat([104.06, 30.67]), zoom: 7 });
      const vectorMap = new Map({ target: "chapter7LinkCanvas", layers: [new VectorLayer({ source: new VectorSource({ url: "/province.geojson", format: new GeoJSON({ featureProjection: "EPSG:3857" }) }), style: new Style({ stroke: new Stroke({ color: "#0b6fae", width: 1.5 }), fill: new Fill({ color: "rgba(11,111,174,0.12)" }) }) })], view: sharedView, controls: [] });
      const imageMap = new Map({ target: "chapter7LinkImage", layers: [createTileLayer()], view: sharedView, controls: [] });
      return () => { vectorMap.setTarget(undefined); imageMap.setTarget(undefined); };
    });
  };

  let heatmapSource;
  // 热力图从现有地震 KML 读取震级，并把震级归一化到 Heatmap 的 weight 范围。
  const createHeatmap = () => {
    if (heatmapLayer) return;
    heatmapSource = new VectorSource({ url: "/earthquakes.kml", format: new KML({ extractStyles: false }), wrapX: false });
    heatmapSource.on("addfeature", (event) => {
      const value = Number.parseFloat(String(event.feature.get("name") || "").replace(/[^0-9.]/g, ""));
      event.feature.set("weight", Number.isFinite(value) ? Math.max(0.15, Math.min(1, (value - 4.5) / 3)) : 0.35);
    });
    heatmapSource.on("featuresloaderror", () => toast("地震 KML 加载失败，热力图暂不可用"));
    heatmapLayer = new Heatmap({ source: heatmapSource, radius: 18, blur: 26, visible: false });
    map.addLayer(heatmapLayer);
  };
  const openHeatmapPanel = () => {
    createHeatmap();
    openPanel("热点图（热力图）", (container) => {
      const toggle = document.createElement("label"); toggle.className = "chapter7-control-row"; toggle.innerHTML = '<span>显示热力图</span><input type="checkbox">';
      const radius = document.createElement("label"); radius.className = "chapter7-control-row"; radius.innerHTML = '<span>热点半径 <output>18</output></span><input type="range" min="5" max="40" value="18">';
      const blur = document.createElement("label"); blur.className = "chapter7-control-row"; blur.innerHTML = '<span>模糊尺度 <output>26</output></span><input type="range" min="5" max="60" value="26">';
      const toggleInput = toggle.querySelector("input"); const radiusInput = radius.querySelector("input"); const blurInput = blur.querySelector("input");
      toggleInput.checked = heatmapLayer.getVisible();
      toggleInput.addEventListener("change", () => heatmapLayer.setVisible(toggleInput.checked));
      radiusInput.addEventListener("input", () => { heatmapLayer.setRadius(Number(radiusInput.value)); radius.querySelector("output").textContent = radiusInput.value; });
      blurInput.addEventListener("input", () => { heatmapLayer.setBlur(Number(blurInput.value)); blur.querySelector("output").textContent = blurInput.value; });
      container.replaceChildren(toggle, radius, blur);
      return () => {};
    });
  };

  // 热区图层常驻主地图，面板只管理绘制、删除和清空交互。
  hotspotSource = new VectorSource();
  hotspotLayer = new VectorLayer({ source: hotspotSource, style: (feature) => feature.get("hotspotHover") ? hotspotHighlightStyle : hotspotStyle });
  map.addLayer(hotspotLayer);
  try {
    const stored = JSON.parse(localStorage.getItem(HOTSPOT_STORAGE_KEY) || "[]");
    stored.filter((item) => item?.id && Array.isArray(item.coordinates)).forEach((item) => hotspotSource.addFeature(new Feature({ geometry: new Polygon([item.coordinates.map((coordinate) => fromLonLat(coordinate))]), ...item })));
  } catch { toast("本地热区数据无法读取，已使用空集合"); }
  // 只把热区属性和经纬度坐标写入本地，刷新后再转换回 EPSG:3857。
  const persistHotspots = () => {
    const values = hotspotSource.getFeatures().map((feature) => ({ id: feature.get("id"), name: feature.get("name"), description: feature.get("description"), createdAt: feature.get("createdAt"), coordinates: feature.getGeometry().getCoordinates()[0].map((coordinate) => toLonLat(coordinate)) }));
    localStorage.setItem(HOTSPOT_STORAGE_KEY, JSON.stringify(values));
  };
  const stopHotspotInteraction = () => { if (hotspotDraw) map.removeInteraction(hotspotDraw); if (hotspotSelect) map.removeInteraction(hotspotSelect); hotspotDraw = undefined; hotspotSelect = undefined; };
  // Draw 完成后通过浏览器对话框补充属性，取消名称则回滚临时 Feature。
  const startHotspotDraw = () => {
    openPanel("热区功能", (container) => {
      const hint = document.createElement("p"); hint.textContent = "绘制多边形后输入热区名称和说明，数据只保存在当前浏览器。";
      const drawButton = document.createElement("button"); drawButton.className = "action-btn"; drawButton.type = "button"; drawButton.textContent = "开始绘制多边形";
      const deleteButton = document.createElement("button"); deleteButton.className = "action-btn"; deleteButton.type = "button"; deleteButton.textContent = "删除热区";
      const clearButton = document.createElement("button"); clearButton.className = "action-btn danger"; clearButton.type = "button"; clearButton.textContent = "清空热区";
      const status = document.createElement("p"); status.className = "chapter7-panel-note"; status.textContent = `当前热区：${hotspotSource.getFeatures().length}`;
      const refreshStatus = () => { status.textContent = `当前热区：${hotspotSource.getFeatures().length}`; };
      drawButton.addEventListener("click", () => {
        stopHotspotInteraction();
        hotspotDraw = new Draw({ source: hotspotSource, type: "Polygon", style: hotspotStyle });
        map.addInteraction(hotspotDraw);
        hotspotDraw.once("drawend", (event) => {
          stopHotspotInteraction();
          const name = window.prompt("热区名称", "新热区");
          if (!name?.trim()) { hotspotSource.removeFeature(event.feature); toast("已取消保存热区"); return; }
          const description = window.prompt("热区说明", "本地绘制热区") || "";
          event.feature.setProperties({ id: `hotspot-${Date.now()}`, name: name.trim(), description, createdAt: new Date().toISOString() });
          persistHotspots(); refreshStatus(); toast("热区已保存");
        });
        toast("请在地图上连续点击绘制热区，双击结束");
      });
      deleteButton.addEventListener("click", () => {
        stopHotspotInteraction();
        hotspotSelect = new Select({ layers: [hotspotLayer], style: hotspotHighlightStyle });
        map.addInteraction(hotspotSelect);
        hotspotSelect.once("select", (event) => {
          const selected = event.selected[0];
          if (selected && window.confirm(`确定删除热区“${selected.get("name") || "未命名"}”吗？`)) { hotspotSource.removeFeature(selected); persistHotspots(); refreshStatus(); toast("热区已删除"); }
          stopHotspotInteraction();
        });
        toast("请点击要删除的热区");
      });
      clearButton.addEventListener("click", () => { if (hotspotSource.getFeatures().length && window.confirm("确定清空全部本地热区吗？")) { hotspotSource.clear(); persistHotspots(); refreshStatus(); toast("热区已清空"); } });
      container.replaceChildren(hint, drawButton, deleteButton, clearButton, status);
      return stopHotspotInteraction;
    });
  };
  const hotspotHoverListener = (event) => {
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: (layer) => layer === hotspotLayer });
    if (hotspotHover && hotspotHover !== feature) hotspotHover.set("hotspotHover", false);
    hotspotHover = feature;
    if (hotspotHover) hotspotHover.set("hotspotHover", true);
    hotspotLayer.changed();
  };
  map.on("pointermove", hotspotHoverListener);

  // 统计图是绑定到省级要素中心点的 Overlay，重绘前统一移除旧图表。
  const chartOverlays = [];
  const clearChartOverlays = () => { chartOverlays.splice(0).forEach((overlay) => map.removeOverlay(overlay)); };
  const getChartData = (name, index) => { const seed = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) + index * 37; return [seed % 2600 + 1800, (seed * 3) % 2900 + 2200, (seed * 5) % 3200 + 2500]; };
  const makeChartElement = (type, name, values) => {
    const element = document.createElement("div"); element.className = "chapter7-chart-overlay";
    const title = document.createElement("strong"); title.textContent = name;
    const subtitle = document.createElement("small"); subtitle.textContent = "示例 GDP（亿元）"; element.append(title, subtitle);
    const max = Math.max(...values);
    if (type === "Pie") {
      const pie = document.createElement("div"); pie.className = "chapter7-pie"; const total = values.reduce((sum, value) => sum + value, 0); const first = values[0] / total * 360; const second = first + values[1] / total * 360; pie.style.background = `conic-gradient(#1685d7 0 ${first}deg, #21b37b ${first}deg ${second}deg, #f1a52b ${second}deg 360deg)`; element.append(pie);
    } else if (type === "Line") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 150 72");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); line.setAttribute("points", values.map((value, index) => `${15 + index * 60},${65 - (value / max) * 48}`).join(" ")); line.setAttribute("fill", "none"); line.setAttribute("stroke", "#ee6666"); line.setAttribute("stroke-width", "3"); svg.append(line); element.append(svg);
    } else {
      const bars = document.createElement("div"); bars.className = "chapter7-bars"; values.forEach((value) => { const bar = document.createElement("i"); bar.style.height = `${Math.max(8, value / max * 100)}%`; bars.append(bar); }); element.append(bars);
    }
    return element;
  };
  const renderCharts = () => {
    openPanel("统计图", (container) => {
      const row = document.createElement("div"); row.className = "chapter7-control-row"; row.innerHTML = '<span>图表类型</span><select><option value="Bar">柱状图</option><option value="Line">折线图</option><option value="Pie">饼图</option></select>';
      const button = document.createElement("button"); button.className = "action-btn"; button.type = "button"; button.textContent = "生成统计图";
      const note = document.createElement("p"); note.className = "chapter7-panel-note"; note.textContent = "图表使用省级 GeoJSON 中心点与确定性示例数据。";
      const render = () => {
        clearChartOverlays();
        const features = map.getLayers().getArray().flatMap((layer) => layer.getSource?.()?.getFeatures?.() || []).filter((feature) => feature.get("name") && feature.getGeometry()?.getType() !== "Point").slice(0, 8);
        features.forEach((feature, index) => { const overlay = new Overlay({ element: makeChartElement(row.querySelector("select").value, feature.get("name"), getChartData(feature.get("name"), index)), position: getCenter(feature.getGeometry().getExtent()), positioning: "bottom-center", offset: [0, -8], stopEvent: true }); map.addOverlay(overlay); chartOverlays.push(overlay); });
        toast(`已生成 ${features.length} 个省份统计图`);
      };
      button.addEventListener("click", render); container.replaceChildren(row, button, note); render();
      return clearChartOverlays;
    });
  };

  // 统一绑定两个关闭按钮，destroy() 时也会复用同一套清理逻辑。
  document.getElementById("chapter7PanelClose").addEventListener("click", closePanel);
  document.getElementById("chapter7PopupClose").addEventListener("click", closePopup);
  return {
    enableVectorMarkers: () => { setMarkerMode("vector"); closePanel(); toast("已启用图文标注"); },
    enableOverlayMarkers: () => { setMarkerMode("overlay"); closePanel(); toast("已启用 Overlay 标注"); },
    addClusters,
    openProjectionPanel,
    openLinkagePanel,
    toggleHeatmap: openHeatmapPanel,
    startHotspotDraw,
    renderCharts,
    destroy: () => {
      closePanel(); closePopup(); stopHotspotInteraction();
      map.un("singleclick", mapClickListener); map.un("singleclick", clusterClickListener); map.un("pointermove", hotspotHoverListener);
      overlayMarkers.forEach((overlay) => map.removeOverlay(overlay)); map.removeOverlay(popupOverlay); map.removeLayer(markerLayer); map.removeLayer(clusterLayer); map.removeLayer(hotspotLayer); if (heatmapLayer) map.removeLayer(heatmapLayer); clearChartOverlays();
    },
  };
};

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
import WebGLTileLayer from "ol/layer/WebGLTile";
import VectorLayer from "ol/layer/Vector";
import Cluster from "ol/source/Cluster";
import TileSource from "ol/source/XYZ";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import { boundingExtent, getCenter } from "ol/extent";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, TitleComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { mapConfig } from "../config/mapConfig";

// 按需注册 ECharts 模块，避免打包完整库。
echarts.use([BarChart, LineChart, PieChart, GridComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

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
// 聚合标注需要较多点才能体现效果：在成都周边用确定性伪随机生成 200 个点。
const clusterPoints = Array.from({ length: 200 }, (_, index) => {
  const angle = index * 2.399963; // 黄金角，分布均匀且结果可复现
  const radius = 0.6 * Math.sqrt((index + 1) / 200);
  return [104.06 + radius * Math.cos(angle), 30.67 + radius * Math.sin(angle) * 0.8];
});
// 统计图示例数据（单位：亿元），数值参考各省公开统计公报，取整后仅供教学演示。
const provinceGdp = {
  广东省: [129119, 135673, 141634],
  江苏省: [122876, 128222, 137008],
  山东省: [87435, 92069, 98566],
  浙江省: [77715, 82553, 90131],
  河南省: [61345, 59132, 63590],
  四川省: [56750, 60133, 64697],
  湖北省: [53735, 55804, 60013],
  福建省: [53110, 54355, 57761],
  湖南省: [48670, 50013, 53231],
  上海市: [44653, 47219, 53927],
  北京市: [41611, 43761, 49843],
  重庆市: [29129, 30146, 32193],
};

// 图文标注和热区共用静态样式；交互状态通过图层的 style 函数切换。
const markerStyle = new Style({
  image: new CircleStyle({ radius: 8, fill: new Fill({ color: "#0b6fae" }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
  text: new Text({ text: "", offsetY: -20, padding: [3, 5, 3, 5], fill: new Fill({ color: "#172331" }), backgroundFill: new Fill({ color: "rgba(255,255,255,0.9)" }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
});
const hotspotStyle = new Style({ fill: new Fill({ color: "rgba(239, 125, 68, 0.25)" }), stroke: new Stroke({ color: "#ef7d44", width: 2 }) });
const hotspotHighlightStyle = new Style({ fill: new Fill({ color: "rgba(239, 125, 68, 0.5)" }), stroke: new Stroke({ color: "#b94722", width: 3 }) });

// 小地图使用天地图 Web 墨卡托瓦片（vec 矢量、img 影像、cva 注记）；
// 在 EPSG:4326 视图中 OpenLayers 会自动对栅格瓦片进行重投影。
const createTiandituSource = (layer) => new TileSource({
  url: `https://t0.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${mapConfig.tiandituKey}`,
  crossOrigin: "anonymous",
});
const createTileLayer = (layer = "img") => new TileLayer({ source: createTiandituSource(layer) });
// 从 KML 名称（如 "M 5.9 - 2012 Jan 15, ..."）中提取震级。
const parseMagnitude = (name) => {
  const match = /M\s*(\d+(?:\.\d+)?)/.exec(String(name || ""));
  return match ? Number(match[1]) : Number.NaN;
};

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
  const clusterPointSource = new VectorSource({
    features: clusterPoints.map((coordinate, index) => new Feature({ geometry: new Point(fromLonLat(coordinate)), markerName: `兴趣点 ${index + 1}`, markerDescription: "聚合示例点", markerCoordinate: coordinate })),
  });
  const clusterSource = new Cluster({ distance: 42, minDistance: 16, source: clusterPointSource });
  const clusterStyleCache = new globalThis.Map();
  const clusterLayer = new VectorLayer({
    source: clusterSource,
    visible: false,
    style: (feature) => {
      const count = (feature.get("features") || []).length;
      const cached = clusterStyleCache.get(count);
      if (cached) return cached;
      const style = new Style({
        image: new CircleStyle({ radius: count > 1 ? Math.min(26, 12 + Math.log2(count) * 3) : 7, fill: new Fill({ color: count > 20 ? "#e5484d" : count > 1 ? "#ef7d44" : "#0b6fae" }), stroke: new Stroke({ color: "#fff", width: 2 }) }),
        text: count > 1 ? new Text({ text: String(count), fill: new Fill({ color: "#fff" }), font: "bold 12px sans-serif" }) : undefined,
      });
      clusterStyleCache.set(count, style);
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
  // 同一个点击监听处理标注、聚合和热区：多点聚合放大到成员范围，其余要素弹出 Popup。
  const isInteractiveLayer = (layer) => layer === markerLayer || layer === clusterLayer || layer === hotspotLayer;
  const mapClickListener = (event) => {
    if (hotspotDraw || hotspotSelect) return;
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: isInteractiveLayer });
    const members = feature?.get("features");
    if (members?.length > 1) {
      closePopup();
      const extent = boundingExtent(members.map((item) => item.getGeometry().getCoordinates()));
      map.getView().fit(extent, { duration: 250, padding: [80, 80, 80, 80], maxZoom: 15 });
    } else if (feature) showPopup(feature, members?.[0]?.getGeometry().getCoordinates() || event.coordinate);
    else closePopup();
  };
  map.on("singleclick", mapClickListener);
  // 鼠标位于可交互要素上时显示手型光标（对应教材 hasFeatureAtPixel 示例）。
  const cursorListener = (event) => {
    if (event.dragging) return;
    const hit = map.hasFeatureAtPixel(event.pixel, { layerFilter: isInteractiveLayer });
    map.getTargetElement().style.cursor = hit ? "pointer" : "";
  };
  map.on("pointermove", cursorListener);

  // 三种标注模式互斥：矢量点、HTML Overlay 或聚合图层只显示一种。
  const setMarkerMode = (mode) => {
    closePopup();
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
  const fitMarkers = () => map.getView().fit(markerSource.getExtent(), { duration: 250, padding: [80, 80, 80, 80], maxZoom: 12 });
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
    closePopup();
    clusterLayer.setVisible(true);
    map.getView().fit(clusterPointSource.getExtent(), { duration: 250, padding: [60, 60, 60, 60] });
    openPanel("聚合标注", (container) => {
      const text = document.createElement("p");
      text.textContent = `共 ${clusterPointSource.getFeatures().length} 个兴趣点。点击聚合点可自动放大，放大到单点后可查看 Popup。`;
      const distance = document.createElement("label"); distance.className = "chapter7-control-row"; distance.innerHTML = '<span>聚合距离 <output>42</output> px</span><input type="range" min="10" max="100" value="42">';
      const distanceInput = distance.querySelector("input");
      distanceInput.value = String(clusterSource.getDistance());
      distance.querySelector("output").textContent = distanceInput.value;
      distanceInput.addEventListener("input", () => { clusterSource.setDistance(Number(distanceInput.value)); distance.querySelector("output").textContent = distanceInput.value; });
      const remove = document.createElement("button");
      remove.className = "action-btn";
      remove.type = "button";
      remove.textContent = "移除聚合标注";
      remove.addEventListener("click", () => { clusterLayer.setVisible(false); closePopup(); closePanel(); toast("已移除聚合标注"); });
      container.append(text, distance, remove);
      return () => {};
    });
    toast("已添加聚合标注");
  };

  // 投影对照：两张地图都叠加天地图矢量底图 + 注记 + 省级 GeoJSON，
  // 4326 视图直接使用经纬度中心，3857 视图通过 fromLonLat 转换中心点。
  const createProjectionMap = (target, projection, center) => new Map({
    target,
    layers: [
      createTileLayer("vec"),
      createTileLayer("cva"),
      new VectorLayer({ source: new VectorSource({ url: "/province.geojson", format: new GeoJSON({ featureProjection: projection }), wrapX: false }), style: new Style({ fill: new Fill({ color: "rgba(22,133,215,0.08)" }), stroke: new Stroke({ color: "#1685d7", width: 1 }) }) }),
    ],
    view: new View({ projection, center, zoom: 3 }),
    controls: [],
  });
  const openProjectionPanel = () => {
    openPanel("投影转换", (container) => {
      const hint = document.createElement("p");
      hint.textContent = "左图 EPSG:4326（经纬度），右图 EPSG:3857（Web 墨卡托，中心经 fromLonLat 转换）。拖动地图查看中心坐标差异。";
      const maps = document.createElement("div");
      maps.className = "chapter7-mini-maps";
      maps.innerHTML = '<div><strong>EPSG:4326</strong><div id="chapter7Projection4326" class="chapter7-mini-map"></div><small class="chapter7-coord" data-proj="4326"></small></div><div><strong>EPSG:3857</strong><div id="chapter7Projection3857" class="chapter7-mini-map"></div><small class="chapter7-coord" data-proj="3857"></small></div>';
      container.replaceChildren(hint, maps);
      const beijing = [116.4, 39.9];
      const map4326 = createProjectionMap("chapter7Projection4326", "EPSG:4326", beijing);
      const map3857 = createProjectionMap("chapter7Projection3857", "EPSG:3857", fromLonLat(beijing));
      // 实时显示两种投影下的视图中心坐标，直观体现单位差异（度 vs 米）。
      const bindCenter = (miniMap, code, digits) => {
        const label = maps.querySelector(`[data-proj="${code}"]`);
        const update = () => { const [x, y] = miniMap.getView().getCenter(); label.textContent = `中心：${x.toFixed(digits)}, ${y.toFixed(digits)}`; };
        miniMap.getView().on("change:center", update);
        update();
      };
      bindCenter(map4326, "4326", 4);
      bindCenter(map3857, "3857", 0);
      return () => { map4326.setTarget(undefined); map3857.setTarget(undefined); };
    });
  };
  // 两个临时地图共享同一个 View，因此中心、分辨率和旋转状态天然同步；
  // 左图用 Canvas 渲染矢量底图，右图用 WebGLTile 渲染影像底图（对应教材 7.3）。
  const openLinkagePanel = () => {
    openPanel("视图联动", (container) => {
      const hint = document.createElement("p");
      hint.textContent = "两个地图共享同一个 View，拖动和缩放会同步。";
      const maps = document.createElement("div");
      maps.className = "chapter7-mini-maps";
      maps.innerHTML = '<div><strong>Canvas · 矢量</strong><div id="chapter7LinkCanvas" class="chapter7-mini-map"></div></div><div><strong>WebGL · 影像</strong><div id="chapter7LinkImage" class="chapter7-mini-map"></div></div>';
      container.replaceChildren(hint, maps);
      const sharedView = new View({ center: map.getView().getCenter(), zoom: map.getView().getZoom() });
      const vectorMap = new Map({ target: "chapter7LinkCanvas", layers: [createTileLayer("vec"), createTileLayer("cva")], view: sharedView, controls: [] });
      const imageMap = new Map({ target: "chapter7LinkImage", layers: [new WebGLTileLayer({ source: createTiandituSource("img") }), createTileLayer("cia")], view: sharedView, controls: [] });
      return () => { vectorMap.setTarget(undefined); imageMap.setTarget(undefined); imageMap.getLayers().forEach((layer) => layer.dispose()); };
    });
  };

  let heatmapSource;
  // 热力图从地震 KML 读取震级，按教材做法 weight = mag - 5（震级均 ≥5），并限制在 [0.1, 1]。
  const createHeatmap = () => {
    if (heatmapLayer) return;
    heatmapSource = new VectorSource({ url: "/earthquakes.kml", format: new KML({ extractStyles: false }), wrapX: false });
    heatmapSource.on("addfeature", (event) => {
      const magnitude = parseMagnitude(event.feature.get("name"));
      event.feature.set("weight", Number.isFinite(magnitude) ? Math.max(0.1, Math.min(1, magnitude - 5)) : 0.3);
    });
    heatmapSource.on("featuresloaderror", () => toast("地震 KML 加载失败，热力图暂不可用"));
    heatmapLayer = new Heatmap({ source: heatmapSource, radius: 10, blur: 15, visible: false });
    map.addLayer(heatmapLayer);
  };
  const openHeatmapPanel = () => {
    createHeatmap();
    openPanel("热点图（热力图）", (container) => {
      const toggle = document.createElement("label"); toggle.className = "chapter7-control-row"; toggle.innerHTML = '<span>显示热力图</span><input type="checkbox">';
      const radius = document.createElement("label"); radius.className = "chapter7-control-row"; radius.innerHTML = '<span>热点半径 <output></output></span><input type="range" min="2" max="40">';
      const blur = document.createElement("label"); blur.className = "chapter7-control-row"; blur.innerHTML = '<span>模糊尺度 <output></output></span><input type="range" min="2" max="60">';
      const toggleInput = toggle.querySelector("input"); const radiusInput = radius.querySelector("input"); const blurInput = blur.querySelector("input");
      // 滑块初值取图层当前值，重新打开面板时保持一致。
      radiusInput.value = String(heatmapLayer.getRadius()); radius.querySelector("output").textContent = radiusInput.value;
      blurInput.value = String(heatmapLayer.getBlur()); blur.querySelector("output").textContent = blurInput.value;
      toggleInput.checked = heatmapLayer.getVisible();
      const fitWorld = document.createElement("button"); fitWorld.className = "action-btn"; fitWorld.type = "button"; fitWorld.textContent = "缩放到全球视图";
      fitWorld.addEventListener("click", () => map.getView().animate({ center: fromLonLat([110, 10]), zoom: 2, duration: 300 }));
      toggleInput.addEventListener("change", () => {
        heatmapLayer.setVisible(toggleInput.checked);
        // 地震数据分布在全球，首次打开时若视图过近则自动缩小，避免看不到热力效果。
        if (toggleInput.checked && map.getView().getZoom() > 4) fitWorld.click();
      });
      radiusInput.addEventListener("input", () => { heatmapLayer.setRadius(Number(radiusInput.value)); radius.querySelector("output").textContent = radiusInput.value; });
      blurInput.addEventListener("input", () => { heatmapLayer.setBlur(Number(blurInput.value)); blur.querySelector("output").textContent = blurInput.value; });
      const note = document.createElement("p"); note.className = "chapter7-panel-note"; note.textContent = "数据：USGS 2012 年 5 级以上地震（KML），权重 = 震级 − 5。";
      container.replaceChildren(toggle, radius, blur, fitWorld, note);
      return () => {};
    });
  };

  // 热区图层常驻主地图，面板只管理绘制、删除和清空交互。
  hotspotSource = new VectorSource();
  hotspotLayer = new VectorLayer({
    source: hotspotSource,
    style: (feature) => {
      // 在基础样式上叠加热区名称标签，悬停时切换高亮样式。
      const style = (feature.get("hotspotHover") ? hotspotHighlightStyle : hotspotStyle).clone();
      if (feature.get("name")) style.setText(new Text({ text: feature.get("name"), font: "bold 12px sans-serif", fill: new Fill({ color: "#7a2e10" }), stroke: new Stroke({ color: "#fff", width: 3 }), overflow: true }));
      return style;
    },
  });
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
          // OpenLayers 先派发 drawend 再把要素加入 source，因此延后到下一轮任务再处理，
          // 否则取消时无法移除要素、保存时也会漏掉刚绘制的热区。
          setTimeout(() => {
            stopHotspotInteraction();
            const name = window.prompt("热区名称", "新热区");
            if (!name?.trim()) { hotspotSource.removeFeature(event.feature); refreshStatus(); toast("已取消保存热区"); return; }
            const description = window.prompt("热区说明", "本地绘制热区") || "";
            event.feature.setProperties({ id: `hotspot-${Date.now()}`, name: name.trim(), description, createdAt: new Date().toISOString() });
            persistHotspots(); refreshStatus(); toast("热区已保存");
          }, 0);
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
    if (event.dragging) return;
    const feature = map.forEachFeatureAtPixel(event.pixel, (candidate) => candidate, { layerFilter: (layer) => layer === hotspotLayer });
    // 仅在悬停目标变化时更新属性；Feature 属性变化会自动触发图层重绘。
    if (feature === hotspotHover) return;
    hotspotHover?.set("hotspotHover", false);
    hotspotHover = feature;
    hotspotHover?.set("hotspotHover", true);
  };
  map.on("pointermove", hotspotHoverListener);

  // 统计图：独立加载省级 GeoJSON，只渲染有 GDP 数据的省份，并在省份中心点叠加 ECharts 图表。
  const chartSource = new VectorSource({ url: "/province.geojson", format: new GeoJSON() });
  const chartLayer = new VectorLayer({
    source: chartSource,
    visible: false,
    style: (feature) => (provinceGdp[feature.get("name")] ? hotspotStyle : undefined),
  });
  map.addLayer(chartLayer);
  const chartOverlays = [];
  const clearChartOverlays = () => {
    chartOverlays.splice(0).forEach(({ overlay, chart }) => { chart.dispose(); map.removeOverlay(overlay); });
  };
  const years = ["2022", "2023", "2024"];
  // 按图表类型返回 ECharts 配置（对应教材中的 switch(type) 写法）。
  const getChartOption = (type, name, values) => {
    const gdpValues = values.map((value) => Number((value / 10000).toFixed(2)));
    const title = { text: name, left: "center", top: 2, textStyle: { fontSize: 12 } };
    const tooltip = { trigger: type === "Pie" ? "item" : "axis", valueFormatter: (value) => `${value} 万亿元` };
    switch (type) {
      case "Pie":
        return {
          title, tooltip,
          series: [{ type: "pie", radius: ["32%", "62%"], center: ["50%", "58%"], label: { show: true, position: "inside", fontSize: 9, formatter: "{b}" }, data: years.map((year, index) => ({ name: year, value: gdpValues[index] })) }],
        };
      case "Line":
        return {
          title, tooltip,
          grid: { left: 34, right: 10, top: 28, bottom: 20 },
          xAxis: { type: "category", data: years, axisLabel: { fontSize: 9 } },
          yAxis: { type: "value", name: "万亿", scale: true, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
          series: [{ type: "line", data: gdpValues, smooth: true, lineStyle: { width: 3, color: "#ee6666" }, itemStyle: { color: "#ee6666" }, symbolSize: 6 }],
        };
      default:
        return {
          title, tooltip,
          grid: { left: 34, right: 10, top: 28, bottom: 20 },
          xAxis: { type: "category", data: years, axisLabel: { fontSize: 9 } },
          yAxis: { type: "value", name: "万亿", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
          series: [{ type: "bar", data: gdpValues, barWidth: "45%", itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "#83bff6" }, { offset: 1, color: "#188df0" }]) } }],
        };
    }
  };
  const renderCharts = () => {
    openPanel("统计图", (container) => {
      const row = document.createElement("div"); row.className = "chapter7-control-row"; row.innerHTML = '<span>图表类型</span><select><option value="Bar">柱状图</option><option value="Line">折线图</option><option value="Pie">饼图</option></select>';
      const select = row.querySelector("select");
      const note = document.createElement("p"); note.className = "chapter7-panel-note"; note.textContent = `展示 ${Object.keys(provinceGdp).length} 个省市 2022–2024 年 GDP，数据为教学示例（取整）。`;
      const render = () => {
        clearChartOverlays();
        const features = chartSource.getFeatures().filter((feature) => provinceGdp[feature.get("name")]);
        features.forEach((feature) => {
          const name = feature.get("name");
          const element = document.createElement("div"); element.className = "chapter7-chart-overlay";
          // 显式指定宽高，元素尚未挂到地图上时 ECharts 也能正确初始化。
          const chart = echarts.init(element, null, { width: 150, height: 112 });
          chart.setOption(getChartOption(select.value, name, provinceGdp[name]));
          // 优先使用 GeoJSON 自带的 center 属性，缺失时退回到外包矩形中心。
          const center = feature.get("center");
          const position = Array.isArray(center) ? fromLonLat(center) : getCenter(feature.getGeometry().getExtent());
          const overlay = new Overlay({ element, position, positioning: "center-center", stopEvent: true });
          map.addOverlay(overlay);
          chartOverlays.push({ overlay, chart });
        });
        if (features.length) {
          const extent = boundingExtent(features.map((feature) => getCenter(feature.getGeometry().getExtent())));
          map.getView().fit(extent, { duration: 250, padding: [90, 90, 90, 90], maxZoom: 6 });
        }
        toast(`已生成 ${features.length} 个省份统计图`);
      };
      select.addEventListener("change", render);
      container.replaceChildren(row, note);
      chartLayer.setVisible(true);
      // GeoJSON 在图层首次可见时才开始加载，加载完成后再渲染图表。
      if (chartSource.getFeatures().length) render();
      else chartSource.once("featuresloadend", render);
      return () => { chartSource.un("featuresloadend", render); clearChartOverlays(); chartLayer.setVisible(false); };
    });
  };

  // 统一绑定两个关闭按钮，destroy() 时也会复用同一套清理逻辑。
  document.getElementById("chapter7PanelClose").addEventListener("click", closePanel);
  document.getElementById("chapter7PopupClose").addEventListener("click", closePopup);
  return {
    enableVectorMarkers: () => { setMarkerMode("vector"); closePanel(); fitMarkers(); toast("已启用图文标注，点击标注查看 Popup"); },
    enableOverlayMarkers: () => { setMarkerMode("overlay"); closePanel(); fitMarkers(); toast("已启用 Overlay 标注，点击标注查看 Popup"); },
    addClusters,
    openProjectionPanel,
    openLinkagePanel,
    toggleHeatmap: openHeatmapPanel,
    startHotspotDraw,
    renderCharts,
    destroy: () => {
      closePanel(); closePopup(); stopHotspotInteraction();
      map.un("singleclick", mapClickListener); map.un("pointermove", cursorListener); map.un("pointermove", hotspotHoverListener);
      overlayMarkers.forEach((overlay) => map.removeOverlay(overlay)); map.removeOverlay(popupOverlay); map.removeLayer(markerLayer); map.removeLayer(clusterLayer); map.removeLayer(hotspotLayer); map.removeLayer(chartLayer); if (heatmapLayer) map.removeLayer(heatmapLayer); clearChartOverlays();
    },
  };
};

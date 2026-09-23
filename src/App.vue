<template>
  <div class="page">
    <!-- 操作按钮 -->
    <div class="btn-group">
      <button @click="mapZoomIn">放大</button>
      <button @click="mapZoomOut">缩小</button>
      <button @click="gotoChengDu">跳转成都</button>
      <button @click="startMeasure('distance')">测距离</button>
      <button @click="startMeasure('area')">测面积</button>
      <button @click="startMeasure('angle')">测角度</button>
      <button @click="toggleChinaShp">显示/隐藏ChinaSHP</button>
    </div>

    <!-- 主地图容器 -->
    <div ref="mapCon" id="map" class="map"></div>

    <!-- 鼠标坐标显示容器 -->
    <div id="mousePosition" class="mouse-pos"></div>
    <!-- 比例尺容器 -->
    <div id="scalebar" class="scale-bar"></div>
    <!-- 鹰眼小地图容器 -->
    <div ref="overviewMap" id="overview" class="overview-map"></div>

    <!-- 测量提示框dom，被Overlay挂载到地图 -->
    <div ref="measureTipRef" class="measure-tip"></div>

    <!-- 测量结果面板 -->
    <aside
      class="measure-results-panel"
      :class="{ 'is-collapsed': resultsPanelCollapsed }"
      aria-label="测量结果"
    >
      <button
        v-if="resultsPanelCollapsed"
        class="measure-panel-toggle measure-panel-toggle-collapsed"
        type="button"
        aria-label="展开测量结果面板"
        title="展开测量结果面板"
        @click="resultsPanelCollapsed = false"
      >
        <span aria-hidden="true">‹</span>
        <span>展开</span>
      </button>
      <template v-else>
        <div class="measure-results-heading">
          <div class="measure-results-title">测量结果</div>
          <button
            class="measure-panel-toggle"
            type="button"
            aria-label="最小化测量结果面板"
            title="最小化测量结果面板"
            @click="resultsPanelCollapsed = true"
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      <div v-if="measureResults.length === 0" class="measure-results-empty">暂无测量结果</div>
      <div v-else class="measure-results-list">
        <div v-for="result in measureResults" :key="result.id" class="measure-result-row">
          <span class="measure-result-value">{{ result.id }}. {{ result.label }}：{{ result.value }}</span>
          <button
            class="measure-action"
            type="button"
            :aria-label="`删除第${result.id}条测量结果`"
            @click="removeMeasurement(result.id)"
          >
            删除
          </button>
        </div>
      </div>
      <button
        class="measure-action measure-clear-all"
        type="button"
        :disabled="measureResults.length === 0"
        @click="clearMeasure"
      >
        全部清除
      </button>
      </template>
    </aside>
  </div>
</template>

<script setup>
// 这是早期 Vue 页面组件，当前实际入口是 index.html + src/main.js；保留供后续迁移参考。
import { ref, onMounted, onUnmounted } from "vue";
// OpenLayers核心模块
import "ol/ol.css";
import { Map, View, Overlay } from "ol";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { get as getProjection } from "ol/proj";
import TileGrid from "ol/tilegrid/TileGrid";
import { getTopLeft, getWidth } from "ol/extent";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';

// 控件导入
import { ZoomSlider, ZoomToExtent, MousePosition, ScaleLine, OverviewMap } from "ol/control";
import { createStringXY } from "ol/coordinate";
// 测量交互、球面计算
import Draw from "ol/interaction/Draw";
import { getLength, getArea } from "ol/sphere";
import { unByKey } from "ol/Observable";

const mapCon = ref(null);
const overviewMap = ref(null);
const measureTipRef = ref(null);
const measureResults = ref([]);
const resultsPanelCollapsed = ref(false);

let map = null;
let draw = null;
let sketchFeature = null;
let geometryListener = null;
let measureOverlay = null;
let measureSequence = 0;
let currentResultText = "";
let currentResultCoordinate = null;
const measureRecords = new globalThis.Map();
const measureOverlays = [];
// 外层全局变量
let chinaShpLayer = null;

// 测量矢量图层
const measureSource = new VectorSource();
const measureLayer = new VectorLayer({ source: measureSource });

// ========= 1.天地图密钥 =========
const TDT_TK = import.meta.env.VITE_TIANDITU_KEY || ""

// 天地图经纬度切片（_c）使用 EPSG:4326 的全球切片网格
const projection = getProjection("EPSG:4326");
const projectionExtent = projection.getExtent();
const size = getWidth(projectionExtent) / 256;
const resolutions = new Array(19);
const matrixIds = new Array(19);
for (let z = 0; z < 19; ++z) {
  resolutions[z] = size / Math.pow(2, z);
  matrixIds[z] = z;
}
const tileGrid = new TileGrid({
  origin: getTopLeft(projectionExtent),
  resolutions,
  matrixIds,
});

// 天地图影像底图
const getTdtImgLayer = () => {
  return new TileLayer({
    title: "天地图影像图层",
    source: new XYZ({
      url: `https://t0.tianditu.gov.cn/img_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TK}`,
      crossOrigin: "anonymous",
      projection,
      tileGrid,
      wrapX: false,
    }),
  });
};
// 天地图影像注记
const getTdtImgLabelLayer = () => {
  return new TileLayer({
    title: "天地图影像注记图层",
    source: new XYZ({
      url: `https://t2.tianditu.gov.cn/cia_c/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${TDT_TK}`,
      crossOrigin: "anonymous",
      projection,
      tileGrid,
      wrapX: false,
    }),
  });
};

// ========= 2.初始化地图 =========
onMounted(() => {
  const imgLayer = getTdtImgLayer();
  const labelLayer = getTdtImgLabelLayer();

  map = new Map({
    target: mapCon.value,
    layers: [imgLayer, labelLayer, measureLayer],
    view: new View({
      center: [104.06, 30.67], // 成都经纬度
      zoom: 7,
      projection,
      minZoom: 1,
      maxZoom: 12,
    }),
  });

  // 实例化测量浮窗Overlay
  measureOverlay = new Overlay({
    element: measureTipRef.value,
    offset: [10, -10],
    positioning: "bottom-left",
    stopEvent: false,
  });
  map.addOverlay(measureOverlay);

  //导航控件 ZoomSlider缩放滑块
  const zoomSlider = new ZoomSlider();
  map.addControl(zoomSlider);

  // ZoomToExtent 快速缩放至预设的中国区域
  const zoomToChina = new ZoomToExtent({
    extent: [73, 3, 135, 54],
    label: "中",
    tipLabel: "缩放至中国范围",
  });
  map.addControl(zoomToChina);

  //鼠标位置控件
  const mousePosCtrl = new MousePosition({
    coordinateFormat: createStringXY(4),
    projection: "EPSG:4326",
    target: document.getElementById("mousePosition"),
  });
  map.addControl(mousePosCtrl);

  //比例尺
  const scaleCtrl = new ScaleLine({ target: document.getElementById("scalebar") });
  map.addControl(scaleCtrl);

  //鹰眼控件
  const overviewCtrl = new OverviewMap({
    target: overviewMap.value,
    layers: [getTdtImgLayer()],
    collapsed: false,
  });
  map.addControl(overviewCtrl);

  //=====GeoServer chinamap WMS图层【修复：去掉const，赋值外层变量】=====
  chinaShpLayer = new ImageLayer({
    source: new ImageWMS({
      url: "http://localhost:8080/geoserver/Chinamap/wms",
      params: {
        LAYERS: "Chinamap:省级行政区",
        VERSION: "1.1.1",
        FORMAT: "image/png",
        TRANSPARENT: true,
        SRS: "EPSG:4326",
        STYLES: "province_style"
      },
      crossOrigin:"anonymous",
      ratio:1
    }),
    opacity:0.7,
    visible:true
  })
  map.addLayer(chinaShpLayer)
});

// =========3.基础地图交互 =========
const mapZoomIn = () => {
  const view = map.getView();
  view.setZoom(view.getZoom() + 1);
};
const mapZoomOut = () => {
  const view = map.getView();
  view.setZoom(view.getZoom() - 1);
};
const gotoChengDu = () => {
  map.getView().setCenter([104.06, 30.67]);
  map.getView().setZoom(7);
};

//切换shp图层显示隐藏【增加判空，防止报错】
const toggleChinaShp = ()=>{
  if(!chinaShpLayer) return;
  chinaShpLayer.setVisible(!chinaShpLayer.getVisible())
}

// =========4.完整测量功能 =========
const startMeasure = (type) => {
  finishCurrentDrawing(); // 切换工具只取消未完成绘制，保留历史结果

  let geometryType = type === "area" ? "Polygon" : "LineString";
  draw = new Draw({
    source: measureSource,
    type: geometryType,
    maxPoints: type === "angle" ? 3 : undefined,
  });
  map.addInteraction(draw);

  draw.on("drawstart", (evt) => {
    sketchFeature = evt.feature;
    //监听几何变化实时计算更新浮窗
    geometryListener = sketchFeature.getGeometry().on("change", (e) => {
      const geom = e.target;
      let resultText = "";
      let lastCoord;

      if (type === "distance") {
        const len = getLength(geom, { projection: "EPSG:4326" });
        resultText = len > 1000 ? `${(len / 1000).toFixed(2)} km` : `${len.toFixed(2)} m`;
        const coords = geom.getCoordinates();
        lastCoord = coords[coords.length - 1];
      } else if (type === "area") {
        const areaVal = getArea(geom, { projection: "EPSG:4326" });
        resultText = areaVal > 1000000 ? `${(areaVal / 1000000).toFixed(2)} km²` : `${areaVal.toFixed(2)} m²`;
        lastCoord = geom.getInteriorPoint().getCoordinates();
      } else if (type === "angle") {
        const coords = geom.getCoordinates();
        resultText = calcAngle(coords);
        lastCoord = coords[1];
      }

      //更新页面标签+浮窗位置
      currentResultText = resultText;
      currentResultCoordinate = lastCoord;
      measureTipRef.value.innerHTML = resultText;
      measureOverlay.setPosition(lastCoord);
    });
  });

  draw.on("drawend", (evt) => {
    if (geometryListener) {
      unByKey(geometryListener);
      geometryListener = null;
    }
    const completedFeature = evt.feature;
    map.removeInteraction(draw);
    draw = null;
    if (currentResultText && currentResultCoordinate) {
      addCompletedMeasurement(type, currentResultText, currentResultCoordinate, completedFeature);
    }
    sketchFeature = null;
    currentResultText = "";
    currentResultCoordinate = null;
    measureOverlay.setPosition(undefined);
    measureTipRef.value.innerHTML = "";
  });
};

const getMeasureLabel = (type) => ({
  distance: "距离",
  area: "面积",
  angle: "角度",
}[type] || "测量");

const addCompletedMeasurement = (type, value, coordinate, feature) => {
  const id = ++measureSequence;
  const hue = Math.round((id * 137.508) % 360);
  const color = `hsl(${hue}, 78%, 42%)`;
  feature.setStyle(new Style({
    stroke: new Stroke({ color, width: 3 }),
    fill: type === "area"
      ? new Fill({ color: `hsla(${hue}, 78%, 42%, 0.2)` })
      : undefined,
  }));

  const labelElement = document.createElement("div");
  labelElement.className = "measure-tip";
  labelElement.textContent = value;

  const overlay = new Overlay({
    element: labelElement,
    offset: [10, -10],
    positioning: "bottom-left",
    stopEvent: false,
  });
  overlay.setPosition(coordinate);
  map.addOverlay(overlay);
  measureOverlays.push(overlay);

  const record = {
    id,
    type,
    label: getMeasureLabel(type),
    value,
    feature,
    overlay,
  };
  measureRecords.set(id, record);
  measureResults.value.push({ id, label: record.label, value: record.value });
};

const removeMeasurement = (id) => {
  const record = measureRecords.get(id);
  if (!record) return;

  measureSource.removeFeature(record.feature);
  map.removeOverlay(record.overlay);
  const overlayIndex = measureOverlays.indexOf(record.overlay);
  if (overlayIndex !== -1) measureOverlays.splice(overlayIndex, 1);
  measureRecords.delete(id);
  measureResults.value = measureResults.value.filter((result) => result.id !== id);
};

const finishCurrentDrawing = () => {
  if (draw) {
    draw.abortDrawing();
    map.removeInteraction(draw);
    draw = null;
  }
  if (geometryListener) {
    unByKey(geometryListener);
    geometryListener = null;
  }
  sketchFeature = null;
  currentResultText = "";
  currentResultCoordinate = null;
  if (measureOverlay) measureOverlay.setPosition(undefined);
  if (measureTipRef.value) measureTipRef.value.innerHTML = "";
};

//余弦定理计算角度
const calcAngle = (coords) => {
  if (coords.length < 3) return "0.00°";
  const p0 = coords[0], p1 = coords[1], p2 = coords[2];
  const getDis = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const disa = getDis(p1, p2);
  const disb = getDis(p1, p0);
  const disc = getDis(p0, p2);
  let cosVal = (disa * disa + disb * disb - disc * disc) / (2 * disa * disb);
  cosVal = Math.max(-1, Math.min(1, cosVal));
  const ang = (Math.acos(cosVal) * 180) / Math.PI;
  return `${ang.toFixed(2)}°`;
};

//清除全部测量绘制、标签
const clearMeasure = () => {
  finishCurrentDrawing();
  measureSource.clear();
  measureRecords.forEach((record) => map.removeOverlay(record.overlay));
  measureRecords.clear();
  measureOverlays.length = 0;
  measureResults.value = [];
  measureSequence = 0;
};

//组件销毁释放资源
onUnmounted(() => {
  clearMeasure();
  if (map) map.setTarget(null);
});
</script>

<style scoped>
.page {
  width: 100%;
  height: 100vh;
  position: relative;
}
.btn-group {
  position: absolute;
  z-index: 999;
  top: 10px;
  left: 10px;
}
.btn-group button {
  margin: 2px;
  padding: 4px 8px;
}
.map {
  width: calc(100% - 282px);
  height: 100%;
  transition: width 180ms ease;
}
.page:has(.measure-results-panel.is-collapsed) .map {
  width: 100%;
}
.mouse-pos {
  position: absolute;
  z-index: 999;
  bottom: 30px;
  left: 10px;
  background: rgba(255, 255, 255, 0.85);
  padding: 2px 6px;
  font-size:12px;
}
.scale-bar {
  position: absolute;
  z-index: 999;
  bottom: 10px;
  left: 10px;
}
.overview-map {
  position: absolute;
  z-index:999;
  right:10px;
  bottom:10px;
  width:220px;
  height:160px;
  border:1px solid #666;
}
.measure-results-panel {
  position: absolute;
  z-index: 1000;
  top: 0;
  right: 16px;
  width: 250px;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #222;
  color: #111;
  transition: width 180ms ease, padding 180ms ease, background-color 180ms ease;
}
.measure-results-panel.is-collapsed {
  width: 48px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.96);
}
.measure-results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.measure-panel-toggle {
  min-width: 32px;
  min-height: 32px;
  border: 1px solid #222;
  border-radius: 6px;
  padding: 2px 7px;
  background: transparent;
  color: #111;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: background-color 120ms ease, color 120ms ease;
}
.measure-panel-toggle:hover,
.measure-panel-toggle:focus-visible {
  background: #172331;
  color: #fff;
}
.measure-panel-toggle-collapsed {
  width: 40px;
  min-width: 40px;
  min-height: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 2px;
  font-size: 11px;
}
.measure-panel-toggle-collapsed span:first-child {
  font-size: 20px;
}
.measure-results-title {
  font-weight: 600;
  line-height: 1.4;
}
.measure-results-empty {
  color: #666;
  font-size: 13px;
}
.measure-results-list {
  min-height: 0;
  overflow-y: auto;
}
.measure-result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.14);
}
.measure-result-value {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.measure-action {
  flex: 0 0 auto;
  border: 1px solid #000;
  border-radius: 999px;
  padding: 3px 10px;
  background: transparent;
  color: #000;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.2;
  transition: background-color 120ms ease;
}
.measure-action:hover:not(:disabled) {
  background: #e53935;
  color: #000;
}
.measure-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.measure-clear-all {
  align-self: flex-end;
}
/* 动态创建的 OpenLayers Overlay 也需要使用该样式 */
:global(.measure-tip) {
  background: rgba(0,0,0,0.75);
  color:#fff;
  padding:2px 6px;
  border-radius:3px;
  font-size:12px;
  pointer-events:none;
}
@media (max-width: 700px) {
  .page {
    min-height: 100vh;
    height: auto;
    padding-bottom: 180px;
    box-sizing: border-box;
  }
  .map {
    width: 100%;
    height: calc(100vh - 180px);
  }
  .page:has(.measure-results-panel.is-collapsed) .map {
    width: 100%;
  }
  .measure-results-panel {
    top: auto;
    right: 10px;
    bottom: 10px;
    left: 10px;
    width: auto;
    max-height: 160px;
  }
  .measure-results-panel.is-collapsed {
    top: auto;
    right: 10px;
    bottom: 10px;
    left: auto;
    width: 52px;
    max-height: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .map,
  .measure-results-panel,
  .measure-panel-toggle {
    transition: none;
  }
}
</style>

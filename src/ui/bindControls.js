import { fromLonLat, toLonLat } from "ol/proj";
import { mapConfig } from "../config/mapConfig";

// 这个模块是“事件接线员”：把页面按钮连接到各个功能控制器。
export const bindControls = ({
  map,
  layers,
  measurements,
  drawings,
  exporter,
  search,
  toast,
  initialState = {},
  onSave,
}) => {
  const validBaseModes = ["imagery", "boundary", "terrain", "amap", "baidu"];
  let currentBaseMode = validBaseModes.includes(initialState.baseMode)
    ? initialState.baseMode
    : "imagery";

  const save = () => onSave({ baseMode: currentBaseMode });

  // 底图切换必须同时更新主地图、鹰眼和按钮高亮状态。
  const setBaseMode = (mode, notify = true) => {
    currentBaseMode = mode;

    const visible = {
      imagery: mode === "imagery",
      boundary: mode === "boundary",
      terrain: mode === "terrain",
      amap: mode === "amap",
      baidu: mode === "baidu",
    };

    layers.base.setVisible(visible.imagery);
    layers.labels.setVisible(visible.imagery);
    layers.boundaryBase.setVisible(visible.boundary);
    layers.terrainBase.setVisible(visible.terrain);
    layers.amapBase.setVisible(visible.amap);
    layers.baiduBase.setVisible(visible.baidu);

    layers.overviewLayers.imagery.setVisible(visible.imagery);
    layers.overviewLayers.labels.setVisible(visible.imagery);
    layers.overviewLayers.boundary.setVisible(visible.boundary);
    layers.overviewLayers.terrain.setVisible(visible.terrain);
    layers.overviewLayers.amap.setVisible(visible.amap);
    layers.overviewLayers.baidu.setVisible(visible.baidu);

    const buttonStates = {
      imageryBaseBtn: visible.imagery,
      boundaryBaseBtn: visible.boundary,
      terrainBaseBtn: visible.terrain,
      amapBaseBtn: visible.amap,
      baiduBaseBtn: visible.baidu,
    };
    Object.entries(buttonStates).forEach(([buttonId, isActive]) => {
      document.getElementById(buttonId).classList.toggle("active", isActive);
    });

    if (!notify) return;

    save();
    const messages = {
      imagery: "已切换到影像底图",
      boundary: "已切换到全球境界地图",
      terrain: "已切换到地形晕渲",
      amap: "已切换到高德底图",
      baidu: "已切换到百度底图",
    };
    toast(messages[mode]);
  };

  validBaseModes.forEach((mode) => {
    document.getElementById(`${mode}BaseBtn`).onclick = () => setBaseMode(mode);
  });

  // 每项依次是：图层注册表名称、按钮 id、提示文字。
  const layerEntries = [
    ["china", "chinaToggle", "省级行政区"],
    ["railway", "railwayToggle", "主要铁路"],
    ["settlement", "settlementToggle", "地市级以上居民地"],
    ["chengduOutline", "chengduOutlineToggle", "成都轮廓"],
    ["provinceOutline", "provinceOutlineToggle", "省份轮廓"],
    ["earthquakes", "earthquakeToggle", "地震数据"],
  ];

  layerEntries.forEach(([layerKey, buttonId, label]) => {
    const layer = layers[layerKey];
    const overviewLayer = layers.overviewLayers[layerKey];
    const initialVisible = initialState.layers?.[layerKey] ?? true;
    const button = document.getElementById(buttonId);

    layer.setVisible(initialVisible);
    overviewLayer?.setVisible(initialVisible);
    button.classList.toggle("on", initialVisible);

    button.onclick = () => {
      const nextVisible = !layer.getVisible();
      layer.setVisible(nextVisible);
      overviewLayer?.setVisible(nextVisible);
      button.classList.toggle("on", nextVisible);
      save();
      toast(`${label}图层已${nextVisible ? "显示" : "隐藏"}`);
    };
  });

  document.getElementById("zoomIn").onclick = () => {
    map.getView().setZoom(map.getView().getZoom() + 1);
  };

  document.getElementById("zoomOut").onclick = () => {
    map.getView().setZoom(map.getView().getZoom() - 1);
  };

  document.getElementById("home").onclick = () => {
    map.getView().setCenter(fromLonLat(mapConfig.defaultCenter));
    map.getView().setZoom(mapConfig.defaultZoom);
    toast("已回到成都视图");
  };

  // 开始一种工具前先停止另一种，保证同一时间只有一种交互生效。
  document.querySelectorAll("[data-measure]").forEach((button) => {
    button.onclick = () => {
      drawings.stop();
      measurements.start(button.dataset.measure);
    };
  });

  document.querySelectorAll("[data-draw-type]").forEach((button) => {
    button.onclick = () => {
      measurements.stop();
      drawings.startDraw(button.dataset.drawType);
    };
  });

  document.getElementById("editDrawingBtn").onclick = () => {
    measurements.stop();
    drawings.startEdit();
    toast("已进入图形编辑模式");
  };

  document.getElementById("clearSelectionBtn").onclick = drawings.clearSelection;
  document.getElementById("deleteSelectedBtn").onclick = drawings.deleteSelected;
  document.getElementById("clearDrawingsBtn").onclick = drawings.clear;

  document.getElementById("clearAll").onclick = () => {
    measurements.clear();
    toast("测量结果已清空");
  };

  document.getElementById("exportImageBtn").onclick = exporter.exportImage;
  document.getElementById("exportPdfBtn").onclick = exporter.exportPdf;

  document.getElementById("searchBox").addEventListener("submit", (event) => {
    event.preventDefault();
    search.search();
  });

  // 侧栏折叠后地图尺寸需要重新计算，否则地图会留下空白区域。
  const setSidebarCollapsed = (collapsed) => {
    const shell = document.querySelector(".app-shell");
    const sidebar = document.getElementById("sidebar");
    const button = document.getElementById("sidebarCollapse");

    sidebar.classList.toggle("collapsed", collapsed);
    shell.classList.toggle("sidebar-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute(
      "aria-label",
      collapsed ? "展开工作台" : "最小化工作台",
    );
    button.title = collapsed ? "展开工作台" : "最小化工作台";

    setTimeout(() => map.updateSize(), 180);
  };

  setSidebarCollapsed(initialState.sidebarCollapsed === true);

  document.getElementById("sidebarCollapse").onclick = () => {
    const collapsed = !document
      .getElementById("sidebar")
      .classList.contains("collapsed");

    setSidebarCollapsed(collapsed);
    save();
  };

  document.getElementById("menuBtn").onclick = () => {
    const sidebar = document.getElementById("sidebar");
    const open = sidebar.classList.toggle("open");
    document.getElementById("menuBtn").setAttribute(
      "aria-expanded",
      String(open),
    );
  };

  map.on("pointermove", (event) => {
    const [longitude, latitude] = toLonLat(event.coordinate);
    document.getElementById("coords").textContent =
      `经度 ${longitude.toFixed(4)}　纬度 ${latitude.toFixed(4)}`;
  });

  setBaseMode(currentBaseMode, false);

  return {
    getBaseMode: () => currentBaseMode,
  };
};


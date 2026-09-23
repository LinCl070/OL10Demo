// OpenLayers 的基础样式和本项目的界面样式都从唯一入口加载。
import "ol/ol.css";
import "./style.css";
import { mapConfig } from "./config/mapConfig";
import { createMap } from "./map/createMap";
import { createWorkspaceState } from "./state/workspaceState";
import { createMeasurementController } from "./features/measurements";
import { createDrawingController } from "./features/drawings";
import { createMapExporter } from "./features/export";
import { createSearchController } from "./features/search";
import { bindControls } from "./ui/bindControls";

// 所有模块共用同一个轻量提示函数，避免重复实现提示框逻辑。
const toast = (text) => {
  const element = document.getElementById("toast");
  element.textContent = text;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 1800);
};
const workspace = createWorkspaceState();
// 页面刷新时先读取上一次保存的工作区状态。
const savedState = workspace.load();
const { map, layers } = createMap();
if (savedState.drawingStyle) {
  Object.assign(layers.drawingStyleState, savedState.drawingStyle);
}
let controls;
// 将各控制器的运行时状态拼成一个普通对象，再交给状态模块保存。
const saveWorkspaceState = () => {
  workspace.save({
    baseMode: controls?.getBaseMode() || savedState.baseMode || "imagery",
    layers: {
      china: layers.china.getVisible(),
      railway: layers.railway.getVisible(),
      settlement: layers.settlement.getVisible(),
      chengduOutline: layers.chengduOutline.getVisible(),
      provinceOutline: layers.provinceOutline.getVisible(),
      earthquakes: layers.earthquakes.getVisible(),
    },
    sidebarCollapsed: document
      .getElementById("sidebar")
      .classList.contains("collapsed"),
    measurements: measurements.getState(),
    drawingStyle: { ...layers.drawingStyleState },
    drawings: drawings.getState(),
  });
};

const measurements = createMeasurementController({
  map,
  source: layers.measurementSource,
  toast,
  onChange: saveWorkspaceState,
});
const drawings = createDrawingController({
  map,
  source: layers.drawingSource,
  layer: layers.drawingLayer,
  styleState: layers.drawingStyleState,
  toast,
  onChange: saveWorkspaceState,
});
const exporter = createMapExporter({ map, toast });
const search = createSearchController({ map, amapKey: mapConfig.amapKey, toast });
// 先恢复数据，再绑定按钮，这样恢复过程不会被误认为用户操作。
measurements.restore(savedState.measurements);
drawings.restore(savedState.drawings);
// 最后由 UI 装配器统一连接所有按钮和地图事件。
controls = bindControls({ map, layers, measurements, drawings, exporter, search, toast, initialState: savedState, onSave: saveWorkspaceState });
saveWorkspaceState();

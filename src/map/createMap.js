import Map from "ol/Map";
import View from "ol/View";
import ScaleLine from "ol/control/ScaleLine";
import ZoomSlider from "ol/control/ZoomSlider";
import OverviewMap from "ol/control/OverviewMap";
import { fromLonLat } from "ol/proj";
import { mapConfig } from "../config/mapConfig";
import { createLayers } from "./layers";

// 创建唯一的 OpenLayers 地图实例，并把图层、比例尺、缩放条和鹰眼装配起来。
export const createMap = (target = "map") => {
  const layers = createLayers();
  const map = new Map({
    target,
    // 图层顺序决定绘制顺序：底图在下，业务图层和用户绘制在上。
    layers: [
      layers.base,
      layers.labels,
      layers.boundaryBase,
      layers.terrainBase,
      layers.amapBase,
      layers.baiduBase,
      layers.measurementLayer,
      layers.china,
      layers.railway,
      layers.settlement,
      layers.provinceOutline,
      layers.chengduOutline,
      layers.earthquakes,
      layers.drawingLayer,
    ],
    view: new View({
      center: fromLonLat(mapConfig.defaultCenter),
      zoom: mapConfig.defaultZoom,
      minZoom: mapConfig.minZoom,
      maxZoom: mapConfig.maxZoom,
    }),
  });
  // 比例尺挂到页面底部的 #scale 容器中；缩放条使用 OpenLayers 默认控件。
  map.addControl(new ScaleLine({ target: "scale" }));
  map.addControl(new ZoomSlider());
  // 鹰眼使用独立图层，避免和主地图共享可见状态对象。
  map.addControl(new OverviewMap({
    collapsed: false,
    layers: Object.values(layers.overviewLayers),
  }));
  return { map, layers };
};

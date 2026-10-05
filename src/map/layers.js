import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import ImageLayer from "ol/layer/Image";
import ImageWMS from "ol/source/ImageWMS";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import KML from "ol/format/KML";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import Projection from "ol/proj/Projection";
import {
  addCoordinateTransforms,
  addProjection,
  fromLonLat,
  get as getProjection,
  toLonLat,
} from "ol/proj";
import TileGrid from "ol/tilegrid/TileGrid";
import { getTopLeft, getWidth } from "ol/extent";
import { mapConfig } from "../config/mapConfig";

const BAIDU_PROJECTION_CODE = "BD-09-MERCATOR";
const earthRadius = 6378137;

const outOfChina = (longitude, latitude) => (
  longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271
);

const transformLatitude = (longitude, latitude) => {
  let value = -100 + 2 * longitude + 3 * latitude + 0.2 * latitude ** 2;
  value += 0.1 * longitude * latitude + 0.2 * Math.sqrt(Math.abs(longitude));
  value += (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(latitude * Math.PI) + 40 * Math.sin(latitude * Math.PI / 3)) * 2 / 3;
  value += (160 * Math.sin(latitude * Math.PI / 12) + 320 * Math.sin(latitude * Math.PI / 30)) * 2 / 3;
  return value;
};

const transformLongitude = (longitude, latitude) => {
  let value = 300 + longitude + 2 * latitude + 0.1 * longitude ** 2;
  value += 0.1 * longitude * latitude + 0.1 * Math.sqrt(Math.abs(longitude));
  value += (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3;
  value += (20 * Math.sin(longitude * Math.PI) + 40 * Math.sin(longitude * Math.PI / 3)) * 2 / 3;
  value += (150 * Math.sin(longitude * Math.PI / 12) + 300 * Math.sin(longitude * Math.PI / 30)) * 2 / 3;
  return value;
};

const wgs84ToGcj02 = ([longitude, latitude]) => {
  if (outOfChina(longitude, latitude)) return [longitude, latitude];
  const offsetLatitude = transformLatitude(longitude - 105, latitude - 35);
  const offsetLongitude = transformLongitude(longitude - 105, latitude - 35);
  const latitudeRadians = latitude / 180 * Math.PI;
  const magic = 1 - 0.006693421622965943 * Math.sin(latitudeRadians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  return [
    longitude + (offsetLongitude * 180) / (6378245 * 180 / Math.PI / sqrtMagic * Math.cos(latitudeRadians)),
    latitude + (offsetLatitude * 180) / (6378245 * (1 - 0.006693421622965943) / (magic * sqrtMagic) * 180 / Math.PI),
  ];
};

const gcj02ToWgs84 = ([longitude, latitude]) => {
  if (outOfChina(longitude, latitude)) return [longitude, latitude];
  const gcj = wgs84ToGcj02([longitude, latitude]);
  return [longitude * 2 - gcj[0], latitude * 2 - gcj[1]];
};

const gcj02ToBd09 = ([longitude, latitude]) => {
  const radius = Math.sqrt(longitude ** 2 + latitude ** 2) + 0.00002 * Math.sin(latitude * Math.PI);
  const angle = Math.atan2(latitude, longitude) + 0.000003 * Math.cos(longitude * Math.PI);
  return [radius * Math.cos(angle) + 0.0065, radius * Math.sin(angle) + 0.006];
};

const bd09ToGcj02 = ([longitude, latitude]) => {
  const adjustedLongitude = longitude - 0.0065;
  const adjustedLatitude = latitude - 0.006;
  const radius = Math.sqrt(adjustedLongitude ** 2 + adjustedLatitude ** 2) - 0.00002 * Math.sin(adjustedLatitude * Math.PI);
  const angle = Math.atan2(adjustedLatitude, adjustedLongitude) - 0.000003 * Math.cos(adjustedLongitude * Math.PI);
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
};

const wgs84ToBd09 = (coordinate) => gcj02ToBd09(wgs84ToGcj02(coordinate));
const bd09ToWgs84 = (coordinate) => gcj02ToWgs84(bd09ToGcj02(coordinate));
const toBaiduMercator = (coordinate) => fromLonLat(wgs84ToBd09(toLonLat(coordinate)));
const fromBaiduMercator = (coordinate) => fromLonLat(bd09ToWgs84(toLonLat(coordinate)));

const baiduProjection = new Projection({
  code: BAIDU_PROJECTION_CODE,
  units: "m",
  extent: getProjection("EPSG:3857").getExtent(),
});
addProjection(baiduProjection);
addCoordinateTransforms("EPSG:3857", baiduProjection, toBaiduMercator, fromBaiduMercator);

const createBaiduSource = () => new XYZ({
  projection: baiduProjection,
  tileGrid: new TileGrid({
    origin: [-20037508.342789244, 20037508.342789244],
    resolutions: Array.from(
      { length: 19 },
      (_, zoom) => (2 * Math.PI * earthRadius) / (256 * 2 ** zoom),
    ),
  }),
  wrapX: true,
  crossOrigin: "anonymous",
  tileUrlFunction: ([z, x, y]) => {
    const offset = Math.pow(2, z - 1);
    const baiduX = x - offset;
    const baiduY = offset - y - 1;
    const server = Math.abs(baiduX + baiduY) % 4 + 1;

    return `http://online${server}.map.bdimg.com/onlinelabel/?qt=tile&styles=pl&scaler=1&p=1&x=${baiduX}&y=${baiduY}&z=${z}`;
  },
});

// 天地图边界和地形图层使用 EPSG:4326，需要专用瓦片网格。
const createTileGrid = () => {
  const projection = getProjection("EPSG:4326");
  const extent = projection.getExtent();
  const size = getWidth(extent) / 256;
  const resolutions = Array.from(
    { length: 19 },
    (_, zoom) => size / Math.pow(2, zoom),
  );

  return {
    projection,
    tileGrid: new TileGrid({
      origin: getTopLeft(extent),
      resolutions,
      matrixIds: resolutions.map((_, zoom) => zoom),
    }),
  };
};

// 根据图层名称和矩阵集生成天地图地址。
// 关键点：边界/地形使用 *_c，影像/标注使用 *_w。
const createTiandituUrl = (layer, tileMatrixSet, server) => (
  `https://t${server}.tianditu.gov.cn/${layer}_${tileMatrixSet}/wmts?` +
  `SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}` +
  `&STYLE=default&TILEMATRIXSET=${tileMatrixSet}&FORMAT=tiles` +
  "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}" +
  `&tk=${mapConfig.tiandituKey}`
);

// 创建 GeoServer WMS 图层。
const createChinaLayer = (layerName, options = {}) => new ImageLayer({
  source: new ImageWMS({
    url: mapConfig.geoserverUrl,
    crossOrigin: "anonymous",
    params: {
      LAYERS: `Chinamap:${layerName}`,
      VERSION: "1.1.1",
      FORMAT: "image/png",
      TRANSPARENT: true,
      SRS: "EPSG:3857",
      STYLES: options.style || "",
    },
    ratio: 1,
  }),
  opacity: options.opacity ?? 0.85,
  visible: options.visible ?? true,
});

// 生成用户绘制图形的统一样式。
const createDrawingStyle = (style) => {
  const colorValue = Number.parseInt(style.fillColor.slice(1), 16);
  const fillColor = `rgba(${colorValue >> 16}, ${(colorValue >> 8) & 255}, ${colorValue & 255}, ${style.fillOpacity})`;

  return new Style({
    fill: new Fill({ color: fillColor }),
    stroke: new Stroke({ color: style.strokeColor, width: style.strokeWidth }),
    image: new CircleStyle({
      radius: 6,
      fill: new Fill({ color: style.fillColor }),
      stroke: new Stroke({ color: style.strokeColor, width: style.strokeWidth }),
    }),
  });
};

const createOutlineLayer = (url, strokeColor, fillColor, width) => new VectorLayer({
  source: new VectorSource({ url, format: new GeoJSON() }),
  style: new Style({
    stroke: new Stroke({ color: strokeColor, width }),
    fill: new Fill({ color: fillColor }),
  }),
});

const createAmapSource = () => new XYZ({
  urls: [1, 2, 3, 4].map(
    (index) => `https://webrd0${index}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}`,
  ),
  wrapX: true,
  crossOrigin: "anonymous",
});

const createTiandituLayer = (layer, tileMatrixSet, server, options = {}) => new TileLayer({
  visible: options.visible ?? true,
  source: new XYZ({
    url: createTiandituUrl(layer, tileMatrixSet, server),
    projection: options.projection,
    tileGrid: options.tileGrid,
    wrapX: options.wrapX ?? true,
    crossOrigin: "anonymous",
  }),
});

// 一次创建主地图和鹰眼所需的全部图层。
export const createLayers = () => {
  const { projection, tileGrid } = createTileGrid();
  const boundaryOptions = { projection, tileGrid, wrapX: false };

  const base = createTiandituLayer("img", "w", 0);
  const labels = createTiandituLayer("cia", "w", 2);
  const boundaryBase = createTiandituLayer("ibo", "c", 0, { ...boundaryOptions, visible: false });
  const terrainBase = createTiandituLayer("ter", "c", 0, { ...boundaryOptions, visible: false });
  const amapBase = new TileLayer({ visible: false, source: createAmapSource() });
  const baiduBase = new TileLayer({ visible: false, source: createBaiduSource() });

  // 测量和绘图使用两个数据源，清空其中一个不会误删另一个。
  const measurementSource = new VectorSource();
  const measurementLayer = new VectorLayer({ source: measurementSource });
  const drawingSource = new VectorSource();
  const drawingStyleState = {
    strokeColor: "#ffcc33",
    strokeWidth: 2,
    fillColor: "#ffcc33",
    fillOpacity: 0.2,
  };
  const drawingLayer = new VectorLayer({
    source: drawingSource,
    style: (feature) => createDrawingStyle(
      feature.get("drawingStyle") || drawingStyleState,
    ),
  });

  const china = createChinaLayer("省级行政区", {
    style: "province_style",
    opacity: 0.65,
  });
  const railway = createChinaLayer("主要铁路", { opacity: 0.95 });
  const settlement = createChinaLayer("地市级以上居民地", { opacity: 0.95 });
  const chengduOutline = createOutlineLayer(
    "/chengdu.geojson",
    "#00d4ff",
    "rgba(0, 212, 255, 0.08)",
    3,
  );
  const provinceOutline = createOutlineLayer(
    "/province.geojson",
    "#ffd166",
    "rgba(255, 209, 102, 0.04)",
    1.5,
  );
  const earthquakes = new VectorLayer({
    source: new VectorSource({
      url: "/earthquakes.kml",
      format: new KML({ extractStyles: false }),
    }),
    style: new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: "#e5484d" }),
        stroke: new Stroke({ color: "#ffffff", width: 1 }),
      }),
    }),
  });

  // 鹰眼使用独立实例，避免和主地图共享可见状态对象。
  const overviewLayers = {
    imagery: createTiandituLayer("img", "w", 0),
    labels: createTiandituLayer("cia", "w", 2),
    boundary: createTiandituLayer("ibo", "c", 0, { ...boundaryOptions, visible: false }),
    terrain: createTiandituLayer("ter", "c", 0, { ...boundaryOptions, visible: false }),
    amap: new TileLayer({ visible: false, source: createAmapSource() }),
    baidu: new TileLayer({ visible: false, source: createBaiduSource() }),
    china: createChinaLayer("省级行政区", { style: "province_style", opacity: 0.65 }),
    railway: createChinaLayer("主要铁路", { opacity: 0.95 }),
    settlement: createChinaLayer("地市级以上居民地", { opacity: 0.95 }),
  };

  return {
    base,
    labels,
    boundaryBase,
    terrainBase,
    amapBase,
    baiduBase,
    measurementSource,
    measurementLayer,
    drawingSource,
    drawingLayer,
    drawingStyleState,
    china,
    railway,
    settlement,
    chengduOutline,
    provinceOutline,
    earthquakes,
    overviewLayers,
  };
};

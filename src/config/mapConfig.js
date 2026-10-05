// 集中保存地图服务地址、默认视图和浏览器运行时配置。
// 其他模块只从这里读取配置，避免把同一个常量复制到多个文件。
export const mapConfig = {
  // 天地图令牌从本地环境变量读取，避免把凭据提交到代码仓库。
  tiandituKey: import.meta.env.VITE_TIANDITU_KEY || "",
  // 优先读取 Vite 环境变量；兼容旧入口注入的 window 配置作为回退。
  amapKey: import.meta.env.VITE_AMAP_WEB_KEY || globalThis.__MAP_CONFIG__?.AMAP_WEB_KEY || "",
  // GeoServer 的 WMS 服务地址。
  geoserverUrl: "http://localhost:8080/geoserver/Chinamap/wms",
  defaultCenter: [104.06, 30.67],
  defaultZoom: 7,
  minZoom: 2,
  maxZoom: 18,
  workspaceStateKey: "atlas-gis-workspace-state-v1",
};
  // 成都的经纬度、缩放范围和本地工作区状态名称。

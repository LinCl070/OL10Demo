# Atlas GIS 工作台

基于 Vite 和 OpenLayers 的 GIS 地图工作台，包含底图切换、业务图层控制、距离/面积/角度测量、图形绘制编辑、地名搜索和地图导出功能。

## 本地运行

```powershell
npm install
Copy-Item .env.example .env.local
# 在 .env.local 中填写 VITE_TIANDITU_KEY 和 VITE_AMAP_WEB_KEY
npm run dev
```

构建生产文件：

```powershell
npm run build
```

## 目录结构

- `src/config`：地图服务和默认视图配置
- `src/map`：底图、业务图层和地图实例
- `src/features`：测量、绘图、导出和搜索功能
- `src/state`：工作区状态读写
- `src/ui`：页面控件和事件绑定
- `public`：GeoJSON、KML 等静态数据

地图服务密钥只应放在本地 `.env.local`，不要提交到 Git 仓库。

import { mapConfig } from "../config/mapConfig";

// 工作区状态只通过这个模块读写 localStorage。
// 如果用户以前保存过损坏的数据，load 会返回空对象，让地图仍然可以启动。
export const createWorkspaceState = () => ({
  load() {
    try {
      return JSON.parse(localStorage.getItem(mapConfig.workspaceStateKey)) || {};
    } catch {
      return {};
    }
  },
  save(state) {
    // state 由入口组装，包含底图、图层、测量记录和绘图记录。
    localStorage.setItem(mapConfig.workspaceStateKey, JSON.stringify(state));
  },
});

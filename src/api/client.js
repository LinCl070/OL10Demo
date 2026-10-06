// 后端 API 客户端：启动时探测 Spring Boot 服务，可用时数据存 PostgreSQL，否则回退到浏览器本地存储。
// 开发环境下 /api 由 Vite 代理到 http://127.0.0.1:8081（见 vite.config.js）。
const request = async (path, { method = "GET", body } = {}) => {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.message || `请求失败（HTTP ${response.status}）`);
  }
  return response.status === 204 ? undefined : response.json();
};

export const createApiClient = () => {
  let available = false;
  return {
    // 只探测一次；探测失败（后端未启动、数据库连不上）时整个会话使用本地存储。
    async detect() {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const response = await fetch("/api/health", { signal: controller.signal });
        clearTimeout(timer);
        available = response.ok && (await response.json()).status === "ok";
      } catch {
        available = false;
      }
      return available;
    },
    get available() {
      return available;
    },
    hotspots: {
      list: () => request("/api/hotspots"),
      create: (hotspot) => request("/api/hotspots", { method: "POST", body: hotspot }),
      remove: (id) => request(`/api/hotspots/${encodeURIComponent(id)}`, { method: "DELETE" }),
      clear: () => request("/api/hotspots", { method: "DELETE" }),
    },
    markers: {
      list: () => request("/api/markers"),
      create: (marker) => request("/api/markers", { method: "POST", body: marker }),
      remove: (id) => request(`/api/markers/${encodeURIComponent(id)}`, { method: "DELETE" }),
      clear: () => request("/api/markers", { method: "DELETE" }),
    },
    provinceGdp: () => request("/api/province-gdp"),
    workspace: {
      measurements: () => request("/api/workspace/measurements"),
      saveMeasurements: (records) => request("/api/workspace/measurements", { method: "PUT", body: records }),
      drawings: () => request("/api/workspace/drawings"),
      saveDrawings: (records) => request("/api/workspace/drawings", { method: "PUT", body: records }),
    },
  };
};

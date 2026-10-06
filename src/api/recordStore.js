// 记录型数据（热区、标注）的统一存取接口：后端可用时走 REST API（PostgreSQL），否则读写 localStorage。
// 两种实现返回相同结构，调用方无需关心数据存在哪里。
export const createRecordStore = ({ api, resource, storageKey, isValid }) => {
  const readLocal = () => {
    try {
      const values = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(values) ? values.filter(isValid) : [];
    } catch {
      return [];
    }
  };
  const writeLocal = (values) => localStorage.setItem(storageKey, JSON.stringify(values));

  if (api?.available) {
    const endpoint = api[resource];
    return {
      backend: "database",
      list: async () => (await endpoint.list()).filter(isValid),
      create: (record) => endpoint.create(record),
      remove: (id) => endpoint.remove(id),
      clear: () => endpoint.clear(),
    };
  }
  return {
    backend: "local",
    list: async () => readLocal(),
    create: async (record) => {
      const saved = { ...record, id: `${resource}-${Date.now()}`, createdAt: new Date().toISOString() };
      writeLocal([...readLocal(), saved]);
      return saved;
    },
    remove: async (id) => writeLocal(readLocal().filter((item) => String(item.id) !== String(id))),
    clear: async () => writeLocal([]),
  };
};

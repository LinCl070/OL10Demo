import Draw from "ol/interaction/Draw";
import Overlay from "ol/Overlay";
import GeoJSON from "ol/format/GeoJSON";
import { Fill, Stroke, Style } from "ol/style";
import { getLength, getArea } from "ol/sphere";

// 测量按钮使用的内部类型名与页面显示名称映射。
const labels = { distance: "距离", area: "面积", angle: "角度" };
// 用三个点计算第二个点处的夹角，返回带度数符号的文本。
const angle = (coordinates) => {
  if (coordinates.length < 3) return "0.00°";
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const a = distance(coordinates[1], coordinates[2]);
  const b = distance(coordinates[1], coordinates[0]);
  const c = distance(coordinates[0], coordinates[2]);
  const cosine = Math.max(-1, Math.min(1, (a * a + b * b - c * c) / (2 * a * b)));
  return `${((Math.acos(cosine) * 180) / Math.PI).toFixed(2)}°`;
};

// 创建测量控制器。它管理绘制交互、临时提示、结果列表和恢复数据。
export const createMeasurementController = ({ map, source, toast, onChange = () => {} }) => {
  const tipEl = document.createElement("div");
  tipEl.className = "measure-tip";
  document.body.appendChild(tipEl);
  const tip = new Overlay({
    element: tipEl,
    offset: [10, -10],
    positioning: "bottom-left",
    stopEvent: false,
  });
  map.addOverlay(tip);
  const geoJSON = new GeoJSON();
  let draw = null;
  let sequence = 0;
  // records 保存地图要素和标签的引用，单条删除时需要用到这些引用。
  let records = [];

  // 每条测量使用不同色相，方便新手在地图上区分多条结果。
  const styleFeature = (feature, type, id) => {
    const hue = ((id - 1) * 137.508 + 30) % 360;
    feature.setStyle(new Style({
      stroke: new Stroke({
        color: `hsl(${hue}, 78%, 42%)`,
        width: 3,
      }),
      fill: type === "area"
        ? new Fill({ color: `hsla(${hue}, 78%, 42%, 0.22)` })
        : undefined,
    }));
  };
  // 只取消当前未完成的绘制，不清除已经完成的结果。
  const stop = () => {
    if (draw) { draw.abortDrawing(); map.removeInteraction(draw); draw = null; }
    tip.setPosition(undefined);
    document.querySelectorAll("[data-measure]").forEach((button) => button.classList.remove("active"));
  };
  // 把 records 渲染到侧栏，并为每个删除按钮绑定对应 id。
  const render = () => {
    const box = document.getElementById("results");
    const clearButton = document.getElementById("clearAll");
    document.getElementById("resultCount").textContent = records.length;
    clearButton.disabled = !records.length;
    if (!records.length) {
      box.innerHTML = '<div class="empty">完成一次测量后，结果会显示在这里。</div>';
      return;
    }

    box.innerHTML = records
      .map((record) => `
        <div class="result-row">
          <div>
            <small>#${record.id} · ${record.label}</small>
            <strong>${record.value}</strong>
          </div>
          <button class="result-remove" data-remove="${record.id}">删除</button>
        </div>
      `)
      .join("");
    box.querySelectorAll("[data-remove]").forEach((button) => {
      button.onclick = () => remove(Number(button.dataset.remove));
    });
  };
  // 绘制结束后，把临时提示固化成独立 Overlay 和列表记录。
  const addRecord = ({ id, type, value, coordinate, feature }) => {
    styleFeature(feature, type, id);
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
    records.push({
      id,
      type,
      label: labels[type],
      value,
      coordinate,
      feature,
      overlay,
    });
    sequence = Math.max(sequence, id);
  };
  // 按记录 id 同时删除图形、地图标签和侧栏记录。
  const remove = (id) => {
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) return;
    source.removeFeature(records[index].feature);
    map.removeOverlay(records[index].overlay);
    records.splice(index, 1);
    render();
    onChange();
  };
  // 启动距离、面积或角度测量，并在绘制过程中实时计算结果。
  const start = (type) => {
    stop();
    draw = new Draw({
      source,
      type: type === "area" ? "Polygon" : "LineString",
      maxPoints: type === "angle" ? 3 : undefined,
    });
    map.addInteraction(draw);
    document.querySelector(`[data-measure="${type}"]`).classList.add("active");
    let value = "";
    let coordinate;
    draw.on("drawstart", (event) => {
      event.feature.getGeometry().on("change", (changeEvent) => {
        const geometry = changeEvent.target;
        const coordinates = geometry.getCoordinates();
        // 距离和面积由 OpenLayers 球面计算工具处理；角度使用本地几何计算。
        if (type === "distance") {
          const length = getLength(geometry, {
            projection: "EPSG:3857",
          });
          value = length > 1000
            ? `${(length / 1000).toFixed(2)} km`
            : `${length.toFixed(2)} m`;
          coordinate = coordinates[coordinates.length - 1];
        } else if (type === "area") {
          const area = getArea(geometry, {
            projection: "EPSG:3857",
          });
          value = area > 1000000
            ? `${(area / 1000000).toFixed(2)} km²`
            : `${area.toFixed(2)} m²`;
          coordinate = geometry.getInteriorPoint().getCoordinates();
        } else {
          value = angle(coordinates);
          coordinate = coordinates[1];
        }
        tipEl.textContent = value;
        tip.setPosition(coordinate);
        styleFeature(event.feature, type, sequence + 1);
      });
    });
    draw.on("drawend", (event) => {
      const incompleteAngle = type === "angle" &&
        event.feature.getGeometry().getCoordinates().length < 3;
      if (!value || !coordinate || incompleteAngle) {
        stop();
        return;
      }
      addRecord({
        id: sequence + 1,
        type,
        value,
        coordinate,
        feature: event.feature,
      });
      render();
      onChange();
      toast("测量结果已保存");
      stop();
    });
  };
  // 清除所有测量结果，供侧栏底部“清空全部结果”按钮调用。
  const clear = () => {
    stop();
    records.forEach((record) => map.removeOverlay(record.overlay));
    source.clear();
    records = [];
    sequence = 0;
    render();
    onChange();
  };
  // 从 localStorage 恢复测量；坏掉的单条记录跳过，不阻塞整个页面。
  const restore = (savedRecords = []) => {
    savedRecords.forEach((savedRecord) => {
      if (
        !labels[savedRecord.type] ||
        !savedRecord.geometry ||
        !Array.isArray(savedRecord.coordinate)
      ) return;
      const id = Number(savedRecord.id);
      if (!Number.isInteger(id) || id < 1) return;
      try {
        const feature = geoJSON.readFeature({ type: "Feature", properties: {}, geometry: savedRecord.geometry }, { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" });
        source.addFeature(feature);
        addRecord({ id, type: savedRecord.type, value: String(savedRecord.value), coordinate: savedRecord.coordinate, feature });
      } catch { /* Ignore one damaged saved measurement. */ }
    });
    render();
  };
  // 只序列化可保存的数据，不把 Feature 和 Overlay 这些运行时对象写进 localStorage。
  const getState = () =>
    records.map((record) => ({
      id: record.id,
      type: record.type,
      value: record.value,
      coordinate: record.coordinate,
      geometry: geoJSON.writeGeometryObject(record.feature.getGeometry(), {
        dataProjection: "EPSG:3857",
        featureProjection: "EPSG:3857",
      }),
    }));

  render();
  return { start, stop, clear, restore, render, getState };
};

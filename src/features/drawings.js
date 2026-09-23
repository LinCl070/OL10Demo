import Feature from "ol/Feature";
import CircleGeometry from "ol/geom/Circle";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Select from "ol/interaction/Select";
import Snap from "ol/interaction/Snap";
import GeoJSON from "ol/format/GeoJSON";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";

// 负责点、线、面、圆的绘制，以及选择、修改和吸附。
export const createDrawingController = ({
  map,
  source,
  layer,
  styleState,
  toast,
  onChange = () => {},
}) => {
  const geoJSON = new GeoJSON();
  let drawingDraw = null;
  let drawingSelect = null;
  let drawingModify = null;
  let drawingSnap = null;
  let sequence = 0;

  // 复制样式对象，避免修改控件时意外改变其他图形的样式。
  const cloneStyle = (style = styleState) => ({
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    fillColor: style.fillColor,
    fillOpacity: style.fillOpacity,
  });

  // 恢复数据时限制颜色、宽度和透明度的合法范围。
  const normalizeStyle = (style = {}, fallback = styleState) => {
    const width = Number(style.strokeWidth);
    const opacity = Number(style.fillOpacity);

    return {
      strokeColor: /^#[0-9a-f]{6}$/i.test(style.strokeColor)
        ? style.strokeColor
        : fallback.strokeColor,
      strokeWidth: Number.isFinite(width)
        ? Math.min(10, Math.max(1, width))
        : fallback.strokeWidth,
      fillColor: /^#[0-9a-f]{6}$/i.test(style.fillColor)
        ? style.fillColor
        : fallback.fillColor,
      fillOpacity: Number.isFinite(opacity)
        ? Math.min(1, Math.max(0, opacity))
        : fallback.fillOpacity,
    };
  };

  // OpenLayers 的 Style 同时覆盖面填充、边线和点符号。
  const createStyle = (style = styleState) => {
    const colorValue = Number.parseInt(style.fillColor.slice(1), 16);
    const fillColor =
      "rgba(" +
      (colorValue >> 16) +
      ", " +
      ((colorValue >> 8) & 255) +
      ", " +
      (colorValue & 255) +
      ", " +
      style.fillOpacity +
      ")";

    return new Style({
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({
        color: style.strokeColor,
        width: style.strokeWidth,
      }),
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: style.fillColor }),
        stroke: new Stroke({
          color: style.strokeColor,
          width: style.strokeWidth,
        }),
      }),
    });
  };

  const selectStyle = new Style({
    fill: new Fill({ color: "rgba(255, 0, 255, 0.28)" }),
    stroke: new Stroke({ color: "#ff00ff", width: 3 }),
    image: new CircleStyle({
      radius: 8,
      fill: new Fill({ color: "#ff00ff" }),
      stroke: new Stroke({ color: "#ffffff", width: 2 }),
    }),
  });

  const syncControls = () => {
    document.getElementById("drawingStrokeColor").value = styleState.strokeColor;
    document.getElementById("drawingStrokeWidth").value = String(styleState.strokeWidth);
    document.getElementById("drawingStrokeWidthValue").textContent =
      String(styleState.strokeWidth) + " px";
    document.getElementById("drawingFillColor").value = styleState.fillColor;
    document.getElementById("drawingFillOpacity").value = String(styleState.fillOpacity);
    document.getElementById("drawingFillOpacityValue").textContent =
      Math.round(styleState.fillOpacity * 100) + "%";
  };

  const clearToolStates = () => {
    document
      .querySelectorAll("[data-draw-type]")
      .forEach((button) => button.classList.remove("active"));
    document.getElementById("editDrawingBtn").classList.remove("active");
  };

  // 切换工具前统一移除旧交互，避免多个交互同时响应鼠标。
  const stop = () => {
    if (drawingDraw) {
      drawingDraw.abortDrawing();
      map.removeInteraction(drawingDraw);
      drawingDraw = null;
    }
    if (drawingModify) {
      map.removeInteraction(drawingModify);
      drawingModify = null;
    }
    if (drawingSelect) {
      drawingSelect.getFeatures().clear();
      map.removeInteraction(drawingSelect);
      drawingSelect = null;
    }
    if (drawingSnap) {
      map.removeInteraction(drawingSnap);
      drawingSnap = null;
    }
    clearToolStates();
  };

  const applyStyle = () => {
    const selectedFeatures = drawingSelect?.getFeatures().getArray() || [];
    const targetFeatures = selectedFeatures.length
      ? selectedFeatures
      : source.getFeatures();

    targetFeatures.forEach((feature) => {
      feature.set("drawingStyle", cloneStyle());
    });
    layer.changed();
    if (drawingDraw) drawingDraw.setStyle(createStyle());
    onChange();
  };

  // 编辑模式由 Select 负责选中、Modify 负责拖动顶点、Snap 负责吸附。
  const startEdit = () => {
    stop();

    drawingSelect = new Select({
      layers: [layer],
      style: selectStyle,
    });
    drawingModify = new Modify({
      features: drawingSelect.getFeatures(),
    });
    drawingSnap = new Snap({ source });

    map.addInteraction(drawingSelect);
    map.addInteraction(drawingModify);
    map.addInteraction(drawingSnap);

    drawingSelect.on("select", (event) => {
      const selectedFeature = event.selected[0];
      if (!selectedFeature) return;

      Object.assign(
        styleState,
        normalizeStyle(selectedFeature.get("drawingStyle")),
      );
      syncControls();
    });

    drawingModify.on("modifyend", onChange);
    document.getElementById("editDrawingBtn").classList.add("active");
  };

  // 绘制完成后保存样式和 id，并自动进入编辑模式。
  const startDraw = (type) => {
    stop();

    drawingDraw = new Draw({
      source,
      type,
      style: createStyle(),
    });
    drawingSnap = new Snap({ source });

    map.addInteraction(drawingDraw);
    map.addInteraction(drawingSnap);
    document
      .querySelector("[data-draw-type=" + type + "]")
      .classList.add("active");

    drawingDraw.on("drawend", (event) => {
      sequence += 1;
      event.feature.setId("drawing-" + sequence);
      event.feature.set("drawingStyle", cloneStyle());
      onChange();
      setTimeout(startEdit, 0);
    });

    const typeLabels = {
      Point: "点",
      LineString: "线",
      Polygon: "多边形",
      Circle: "圆",
    };
    toast("已进入" + typeLabels[type] + "绘制模式");
  };

  // 侧栏控件变化后，更新选中的图形；没有选中时更新全部图形。
  const updateStyle = () => {
    styleState.strokeColor =
      document.getElementById("drawingStrokeColor").value;
    styleState.strokeWidth = Number(
      document.getElementById("drawingStrokeWidth").value,
    );
    styleState.fillColor =
      document.getElementById("drawingFillColor").value;
    styleState.fillOpacity = Number(
      document.getElementById("drawingFillOpacity").value,
    );

    syncControls();
    applyStyle();
  };

  const clearSelection = () => {
    if (drawingSelect) drawingSelect.getFeatures().clear();
    toast("已取消图形选择");
  };

  const deleteSelected = () => {
    const selectedFeatures = drawingSelect?.getFeatures();
    if (!selectedFeatures?.getLength()) {
      toast("请先在编辑模式中选择图形");
      return;
    }

    selectedFeatures
      .getArray()
      .slice()
      .forEach((feature) => source.removeFeature(feature));
    selectedFeatures.clear();
    onChange();
    toast("已删除选中图形");
  };

  const clear = () => {
    stop();
    source.clear();
    sequence = 0;
    onChange();
    toast("已清空全部绘制图形");
  };

  // 圆不是标准 GeoJSON 几何，因此单独保存圆心和半径。
  const serialize = (feature) => {
    const geometry = feature.getGeometry();
    const record = {
      id: feature.getId(),
      geometryType: geometry.getType(),
      style: cloneStyle(feature.get("drawingStyle") || styleState),
    };

    if (record.geometryType === "Circle") {
      record.circle = {
        center: geometry.getCenter(),
        radius: geometry.getRadius(),
      };
    } else {
      record.geometry = geoJSON.writeGeometryObject(geometry, {
        dataProjection: "EPSG:3857",
        featureProjection: "EPSG:3857",
      });
    }

    return record;
  };

  // 页面启动时逐条恢复绘制数据，单条损坏时跳过。
  const restore = (saved = []) => {
    saved.forEach((record) => {
      try {
        let feature;

        if (record.geometryType === "Circle") {
          if (
            !Array.isArray(record.circle?.center) ||
            !Number.isFinite(record.circle?.radius)
          ) {
            return;
          }
          feature = new Feature(
            new CircleGeometry(record.circle.center, record.circle.radius),
          );
        } else {
          if (
            !record.geometry ||
            !["Point", "LineString", "Polygon"].includes(record.geometryType)
          ) {
            return;
          }
          feature = geoJSON.readFeature(
            {
              type: "Feature",
              properties: {},
              geometry: record.geometry,
            },
            {
              dataProjection: "EPSG:3857",
              featureProjection: "EPSG:3857",
            },
          );
        }

        feature.setId(String(record.id));
        feature.set("drawingStyle", normalizeStyle(record.style));
        source.addFeature(feature);

        const sequenceMatch = /^drawing-(\d+)$/.exec(String(record.id));
        if (sequenceMatch) {
          sequence = Math.max(sequence, Number(sequenceMatch[1]));
        }
      } catch {
        // 忽略单条损坏的绘制记录，保留其他记录。
      }
    });

    syncControls();
  };

  const getState = () => source.getFeatures().map(serialize);

  syncControls();
  [
    "drawingStrokeColor",
    "drawingStrokeWidth",
    "drawingFillColor",
    "drawingFillOpacity",
  ].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateStyle);
  });

  return {
    startDraw,
    startEdit,
    stop,
    clear,
    clearSelection,
    deleteSelected,
    restore,
    getState,
    syncControls,
  };
};


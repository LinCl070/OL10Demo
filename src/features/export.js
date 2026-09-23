import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

// 导出控制器负责截图、下载文件和按钮忙碌状态。
export const createMapExporter = ({ map, toast }) => {
  const buttons = [
    document.getElementById("exportImageBtn"),
    document.getElementById("exportPdfBtn"),
  ];

  const setBusy = (busy) => {
    buttons.forEach((button) => {
      button.disabled = busy;
      button.setAttribute("aria-busy", String(busy));
    });
  };

  // 先强制地图完成渲染，再交给 html2canvas 截图。
  const captureMap = async () => {
    map.renderSync();
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

    const mapElement = document.getElementById("map");
    if (!mapElement.clientWidth || !mapElement.clientHeight) {
      throw new Error("EMPTY_MAP");
    }

    return html2canvas(mapElement, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      scale: Math.min(globalThis.devicePixelRatio || 1, 2),
    });
  };

  const runExport = async (task, successMessage) => {
    setBusy(true);

    try {
      const canvas = await captureMap();
      await task(canvas);
      toast(successMessage);
    } catch (error) {
      console.error("Map export failed", error);
      toast("导出失败：请切换底图或关闭不支持跨域导出的图层");
    } finally {
      setBusy(false);
    }
  };

  const exportImage = () => runExport(async (canvas) => {
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) throw new Error("PNG_ENCODE_FAILED");

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "atlas-map.png";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, "地图图片已导出");

  const exportPdf = () => runExport(async (canvas) => {
    const orientation = canvas.width >= canvas.height
      ? "landscape"
      : "portrait";
    const pdf = new jsPDF({
      orientation,
      unit: "px",
      format: [canvas.width, canvas.height],
      hotfixes: ["px_scaling"],
    });

    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      canvas.width,
      canvas.height,
    );
    pdf.save("atlas-map.pdf");
  }, "地图 PDF 已导出");

  return { exportImage, exportPdf };
};


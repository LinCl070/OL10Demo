import { fromLonLat } from "ol/proj";

// 高德返回 GCJ-02，而 OpenLayers 主地图使用 WGS-84，需要转换。
const outOfChina = (longitude, latitude) => (
  longitude < 72.004 ||
  longitude > 137.8347 ||
  latitude < 0.8293 ||
  latitude > 55.8271
);

const transformLatitude = (longitude, latitude) => {
  let result =
    -100 +
    2 * longitude +
    3 * latitude +
    0.2 * latitude * latitude +
    0.1 * longitude * latitude +
    0.2 * Math.sqrt(Math.abs(longitude));

  result += (
    20 * Math.sin(6 * longitude * Math.PI) +
    20 * Math.sin(2 * longitude * Math.PI)
  ) * 2 / 3;
  result += (
    20 * Math.sin(latitude * Math.PI) +
    40 * Math.sin(latitude / 3 * Math.PI)
  ) * 2 / 3;
  result += (
    160 * Math.sin(latitude / 12 * Math.PI) +
    320 * Math.sin(latitude * Math.PI / 30)
  ) * 2 / 3;

  return result;
};

const transformLongitude = (longitude, latitude) => {
  let result =
    300 +
    longitude +
    2 * latitude +
    0.1 * longitude * longitude +
    0.1 * longitude * latitude +
    0.1 * Math.sqrt(Math.abs(longitude));

  result += (
    20 * Math.sin(6 * longitude * Math.PI) +
    20 * Math.sin(2 * longitude * Math.PI)
  ) * 2 / 3;
  result += (
    20 * Math.sin(longitude * Math.PI) +
    40 * Math.sin(longitude / 3 * Math.PI)
  ) * 2 / 3;
  result += (
    150 * Math.sin(longitude / 12 * Math.PI) +
    300 * Math.sin(longitude / 30 * Math.PI)
  ) * 2 / 3;

  return result;
};

const gcj02ToWgs84 = (longitude, latitude) => {
  if (outOfChina(longitude, latitude)) return [longitude, latitude];

  const earthRadius = 6378245;
  const eccentricity = 0.006693421622965943;
  const deltaLatitude = transformLatitude(longitude - 105, latitude - 35);
  const deltaLongitude = transformLongitude(longitude - 105, latitude - 35);
  const radLatitude = latitude / 180 * Math.PI;
  const magic = 1 - eccentricity * Math.sin(radLatitude) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  const latitudeDelta =
    deltaLatitude * 180 /
    ((earthRadius * (1 - eccentricity)) /
      (magic * sqrtMagic) * Math.PI);
  const longitudeDelta =
    deltaLongitude * 180 /
    (earthRadius / sqrtMagic * Math.cos(radLatitude) * Math.PI);

  return [longitude - longitudeDelta, latitude - latitudeDelta];
};

// 创建搜索控制器：读取输入、调用高德并移动地图中心点。
export const createSearchController = ({ map, amapKey, toast }) => {
  const setMessage = (text, state = "") => {
    const element = document.getElementById("searchMessage");
    element.textContent = text;
    element.className = ("search-message " + state).trim();
  };

  const search = async () => {
    const input = document.getElementById("searchInput");
    const button = document.getElementById("searchButton");
    const keyword = input.value.trim();

    if (!keyword) {
      setMessage("请输入搜索关键字", "error");
      return;
    }
    if (!amapKey) {
      setMessage("请配置高德 Web 服务 Key", "error");
      return;
    }

    button.disabled = true;
    setMessage("搜索中…");

    try {
      const url = new URL("https://restapi.amap.com/v3/geocode/geo");
      url.searchParams.set("key", amapKey);
      url.searchParams.set("address", keyword);
      url.searchParams.set("output", "JSON");

      const response = await fetch(url);
      if (!response.ok) throw new Error("HTTP_ERROR");

      const data = await response.json();
      if (
        data.status !== "1" ||
        !Array.isArray(data.geocodes) ||
        !data.geocodes.length
      ) {
        throw new Error("NO_RESULT");
      }

      const first = data.geocodes[0];
      const [gcjLongitude, gcjLatitude] = first.location
        .split(",")
        .map(Number);
      if (!Number.isFinite(gcjLongitude) || !Number.isFinite(gcjLatitude)) {
        throw new Error("INVALID_LOCATION");
      }

      const [longitude, latitude] = gcj02ToWgs84(
        gcjLongitude,
        gcjLatitude,
      );
      map.getView().setCenter(fromLonLat([longitude, latitude]));
      map.getView().setZoom(12);

      const summary =
        first.formatted_address ||
        [first.province, first.city, first.district]
          .filter(Boolean)
          .join(" ") ||
        keyword;
      setMessage(summary, "success");
      toast("已定位到：" + summary);
    } catch (error) {
      setMessage(
        error.message === "NO_RESULT"
          ? "没有找到匹配地点"
          : "搜索服务暂时不可用",
        "error",
      );
    } finally {
      button.disabled = false;
    }
  };

  return { search };
};


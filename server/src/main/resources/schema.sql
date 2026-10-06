-- 由 Spring Boot 在启动时执行（spring.sql.init.mode=always），所有语句均可重复执行。
-- 需要先在 PostgreSQL 中安装 PostGIS 扩展（Windows 可通过 Stack Builder 安装）。
CREATE EXTENSION IF NOT EXISTS postgis;

-- 热区（教材 7.5）：多边形区域标注，坐标为 WGS84 经纬度。
CREATE TABLE IF NOT EXISTS hotspots (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  geom        geometry(Polygon, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hotspots_geom_idx ON hotspots USING GIST (geom);

-- 用户交互式标注 / 兴趣点（教材 7.1、练习 1），坐标为 WGS84 经纬度。
CREATE TABLE IF NOT EXISTS markers (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  geom        geometry(Point, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS markers_geom_idx ON markers USING GIST (geom);

-- 统计图数据（教材 7.6），单位：亿元。
CREATE TABLE IF NOT EXISTS province_gdp (
  province VARCHAR(50) PRIMARY KEY,
  gdp_2022 NUMERIC(12, 2) NOT NULL,
  gdp_2023 NUMERIC(12, 2) NOT NULL,
  gdp_2024 NUMERIC(12, 2) NOT NULL
);

-- 测量结果：几何沿用前端的 Web 墨卡托坐标（EPSG:3857），label_x/label_y 为结果标签位置。
CREATE TABLE IF NOT EXISTS measurements (
  id      INTEGER PRIMARY KEY,
  type    VARCHAR(16) NOT NULL CHECK (type IN ('distance', 'area', 'angle')),
  value   VARCHAR(64) NOT NULL,
  label_x DOUBLE PRECISION NOT NULL,
  label_y DOUBLE PRECISION NOT NULL,
  geom    geometry(Geometry, 3857) NOT NULL
);

-- 绘制图形（EPSG:3857）：圆没有对应的 GeoJSON 类型，保存为圆心点 + 半径。
CREATE TABLE IF NOT EXISTS drawings (
  id            VARCHAR(64) PRIMARY KEY,
  sort_order    INTEGER NOT NULL,
  geometry_type VARCHAR(16) NOT NULL CHECK (geometry_type IN ('Point', 'LineString', 'Polygon', 'Circle')),
  style         JSONB NOT NULL,
  geom          geometry(Geometry, 3857) NOT NULL,
  radius        DOUBLE PRECISION CHECK (radius > 0),
  -- 圆必须有半径，其他类型不能有；几何类型必须与 geometry_type 一致。
  CHECK ((geometry_type = 'Circle') = (radius IS NOT NULL)),
  CHECK (GeometryType(geom) = CASE geometry_type WHEN 'Circle' THEN 'POINT' ELSE upper(geometry_type) END)
);

# Atlas GIS 后端（Spring Boot + PostgreSQL/PostGIS）

为前端提供 REST API，数据存入 PostgreSQL，空间字段使用 PostGIS `geometry` 类型。

| 接口 | 说明 | 表 |
|---|---|---|
| `GET/POST/DELETE /api/hotspots[/{id}]` | 热区增删查（教材 7.5） | `hotspots`，`geometry(Polygon, 4326)` |
| `GET/POST/DELETE /api/markers[/{id}]` | 交互式标注 / 兴趣点 | `markers`，`geometry(Point, 4326)` |
| `GET /api/province-gdp` | 统计图 GDP 数据（教材 7.6） | `province_gdp` |
| `GET/PUT /api/workspace/measurements` | 测量结果整体同步 | `measurements`，EPSG:3857 |
| `GET/PUT /api/workspace/drawings` | 绘制图形整体同步 | `drawings`，EPSG:3857 |
| `GET /api/health` | 健康检查（含 PostGIS 版本） | — |

## 环境要求

- JDK 17+（推荐 25）；Maven 由 `mvnw` 自动下载，无需单独安装
- PostgreSQL 并已安装 PostGIS 扩展

## 首次运行

1. 创建数据库（只需一次）：

   ```powershell
   & "D:\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE atlas_gis"
   ```

   表结构和示例数据会在后端启动时由 `schema.sql` / `data.sql` 自动创建，可重复执行。

2. 设置数据库密码并启动（密码只放在环境变量里，不要写进仓库）：

   ```powershell
   cd server
   $env:JAVA_HOME = "C:\Program Files\Java\jdk-25"
   $env:ATLAS_DB_PASSWORD = "你的 postgres 密码"
   .\mvnw.cmd spring-boot:run
   ```

   也可以新建 `server/config/application.properties`（已被 `.gitignore` 忽略）写入
   `spring.datasource.password=...`，Spring Boot 启动时会自动读取。

3. 在项目根目录另开终端执行 `npm run dev`，侧栏底部显示“数据库：PostgreSQL 已连接”即成功。

## 可选环境变量

| 变量 | 默认值 |
|---|---|
| `ATLAS_DB_URL` | `jdbc:postgresql://localhost:5432/atlas_gis` |
| `ATLAS_DB_USER` | `postgres` |
| `ATLAS_DB_PASSWORD` | 空 |
| `ATLAS_SERVER_PORT` | `8081`（8080 已被 GeoServer 占用） |

## 安全说明

接口没有登录鉴权，后端只监听 `127.0.0.1`，仅供本机开发使用；前端通过 Vite 代理同源访问，未开启 CORS。
若要部署到服务器，需要先增加身份认证。所有 SQL 均使用参数绑定。

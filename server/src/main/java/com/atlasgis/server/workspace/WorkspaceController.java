package com.atlasgis.server.workspace;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 测量结果与绘制图形的整体同步：前端每次变更后 PUT 完整列表，后端在一个事务中整体替换。
 * JSON 的拆解和拼装交给 PostgreSQL（jsonb + PostGIS GeoJSON 函数），请求体始终作为参数绑定，
 * 字段类型、取值范围由 schema.sql 中的约束校验，不合法的数据会让整个事务回滚。
 */
@RestController
@RequestMapping(path = "/api/workspace", produces = MediaType.APPLICATION_JSON_VALUE)
public class WorkspaceController {

    private final JdbcClient jdbc;

    public WorkspaceController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/measurements")
    public String measurements() {
        return jdbc.sql("""
                        SELECT COALESCE(json_agg(json_build_object(
                                 'id', id,
                                 'type', type,
                                 'value', value,
                                 'coordinate', json_build_array(label_x, label_y),
                                 'geometry', ST_AsGeoJSON(geom)::json) ORDER BY id), '[]')::text
                        FROM measurements
                        """)
                .query(String.class)
                .single();
    }

    @PutMapping(path = "/measurements", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void replaceMeasurements(@RequestBody String body) {
        jdbc.sql("DELETE FROM measurements").update();
        jdbc.sql("""
                        INSERT INTO measurements (id, type, value, label_x, label_y, geom)
                        SELECT (e ->> 'id')::int,
                               e ->> 'type',
                               e ->> 'value',
                               (e -> 'coordinate' ->> 0)::float8,
                               (e -> 'coordinate' ->> 1)::float8,
                               ST_SetSRID(ST_GeomFromGeoJSON(e ->> 'geometry'), 3857)
                        FROM jsonb_array_elements(CAST(:body AS jsonb)) AS t(e)
                        """)
                .param("body", body)
                .update();
    }

    @GetMapping("/drawings")
    public String drawings() {
        return jdbc.sql("""
                        SELECT COALESCE(jsonb_agg(
                                 jsonb_build_object('id', id, 'geometryType', geometry_type, 'style', style)
                                 || CASE WHEN geometry_type = 'Circle'
                                      THEN jsonb_build_object('circle', jsonb_build_object(
                                             'center', jsonb_build_array(ST_X(geom), ST_Y(geom)),
                                             'radius', radius))
                                      ELSE jsonb_build_object('geometry', ST_AsGeoJSON(geom)::jsonb)
                                    END
                                 ORDER BY sort_order), '[]')::text
                        FROM drawings
                        """)
                .query(String.class)
                .single();
    }

    @PutMapping(path = "/drawings", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void replaceDrawings(@RequestBody String body) {
        jdbc.sql("DELETE FROM drawings").update();
        // 圆保存为圆心点 + 半径；其他图形直接由 GeoJSON 转为 PostGIS 几何。
        jdbc.sql("""
                        INSERT INTO drawings (id, sort_order, geometry_type, style, geom, radius)
                        SELECT e ->> 'id',
                               t.ord,
                               e ->> 'geometryType',
                               e -> 'style',
                               CASE WHEN e ->> 'geometryType' = 'Circle'
                                    THEN ST_SetSRID(ST_MakePoint((e -> 'circle' -> 'center' ->> 0)::float8,
                                                                 (e -> 'circle' -> 'center' ->> 1)::float8), 3857)
                                    ELSE ST_SetSRID(ST_GeomFromGeoJSON(e ->> 'geometry'), 3857)
                               END,
                               CASE WHEN e ->> 'geometryType' = 'Circle'
                                    THEN (e -> 'circle' ->> 'radius')::float8
                               END
                        FROM jsonb_array_elements(CAST(:body AS jsonb)) WITH ORDINALITY AS t(e, ord)
                        """)
                .param("body", body)
                .update();
    }
}

package com.atlasgis.server.hotspot;

import com.atlasgis.server.geo.LonLat;
import com.fasterxml.jackson.annotation.JsonRawValue;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** 热区增删查（教材 7.5 中 RegDataServer 的职责），几何存为 PostGIS Polygon(4326)。 */
@RestController
@RequestMapping("/api/hotspots")
public class HotspotController {

    /** coordinates 为外环经纬度：[[lon, lat], ...]。 */
    public record HotspotInput(
            @NotBlank(message = "热区名称不能为空") @Size(max = 100, message = "热区名称不能超过 100 个字符") String name,
            @Size(max = 500, message = "热区说明不能超过 500 个字符") String description,
            @NotNull(message = "热区坐标不能为空") List<List<Double>> coordinates) {
    }

    /** coordinates 直接输出 PostGIS 生成的 JSON 数组，避免在 Java 中重复解析。 */
    public record Hotspot(
            long id,
            String name,
            String description,
            OffsetDateTime createdAt,
            @JsonRawValue String coordinates) {
    }

    private static final String SELECT = """
            SELECT id, name, description, created_at,
                   (ST_AsGeoJSON(geom)::json -> 'coordinates' -> 0)::text AS coordinates
            FROM hotspots
            """;

    private final JdbcClient jdbc;

    public HotspotController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Hotspot> list() {
        return jdbc.sql(SELECT + " ORDER BY id").query(this::map).list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Hotspot create(@Valid @RequestBody HotspotInput input) {
        long id = jdbc.sql("""
                        INSERT INTO hotspots (name, description, geom)
                        VALUES (:name, :description, ST_GeomFromText(:wkt, 4326))
                        RETURNING id
                        """)
                .param("name", input.name().trim())
                .param("description", Objects.requireNonNullElse(input.description(), "").trim())
                .param("wkt", LonLat.polygonWkt(input.coordinates()))
                .query(Long.class)
                .single();
        return jdbc.sql(SELECT + " WHERE id = :id").param("id", id).query(this::map).single();
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        if (jdbc.sql("DELETE FROM hotspots WHERE id = :id").param("id", id).update() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "热区不存在");
        }
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clear() {
        jdbc.sql("DELETE FROM hotspots").update();
    }

    private Hotspot map(ResultSet rs, int rowNum) throws SQLException {
        return new Hotspot(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getString("coordinates"));
    }
}

package com.atlasgis.server.marker;

import com.atlasgis.server.geo.LonLat;
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

/** 用户交互式标注 / 兴趣点的增删查，几何存为 PostGIS Point(4326)。 */
@RestController
@RequestMapping("/api/markers")
public class MarkerController {

    /** coordinate 为 [经度, 纬度]。 */
    public record MarkerInput(
            @NotBlank(message = "标注名称不能为空") @Size(max = 100, message = "标注名称不能超过 100 个字符") String name,
            @Size(max = 500, message = "标注说明不能超过 500 个字符") String description,
            @NotNull(message = "标注坐标不能为空") List<Double> coordinate) {
    }

    public record Marker(
            long id,
            String name,
            String description,
            OffsetDateTime createdAt,
            List<Double> coordinate) {
    }

    private static final String SELECT = """
            SELECT id, name, description, created_at, ST_X(geom) AS lon, ST_Y(geom) AS lat
            FROM markers
            """;

    private final JdbcClient jdbc;

    public MarkerController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Marker> list() {
        return jdbc.sql(SELECT + " ORDER BY id").query(this::map).list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Marker create(@Valid @RequestBody MarkerInput input) {
        double[] coordinate = LonLat.require(input.coordinate());
        long id = jdbc.sql("""
                        INSERT INTO markers (name, description, geom)
                        VALUES (:name, :description, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
                        RETURNING id
                        """)
                .param("name", input.name().trim())
                .param("description", Objects.requireNonNullElse(input.description(), "").trim())
                .param("lon", coordinate[0])
                .param("lat", coordinate[1])
                .query(Long.class)
                .single();
        return jdbc.sql(SELECT + " WHERE id = :id").param("id", id).query(this::map).single();
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        if (jdbc.sql("DELETE FROM markers WHERE id = :id").param("id", id).update() == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "标注不存在");
        }
    }

    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clear() {
        jdbc.sql("DELETE FROM markers").update();
    }

    private Marker map(ResultSet rs, int rowNum) throws SQLException {
        return new Marker(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getObject("created_at", OffsetDateTime.class),
                List.of(rs.getDouble("lon"), rs.getDouble("lat")));
    }
}

package com.atlasgis.server.gdp;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 统计图数据（教材 7.6）：返回各省 2022–2024 年 GDP（亿元）。 */
@RestController
public class ProvinceGdpController {

    public record ProvinceGdp(String province, List<Double> values) {
    }

    private final JdbcClient jdbc;

    public ProvinceGdpController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/province-gdp")
    public List<ProvinceGdp> list() {
        return jdbc.sql("SELECT province, gdp_2022, gdp_2023, gdp_2024 FROM province_gdp ORDER BY gdp_2024 DESC")
                .query((rs, rowNum) -> new ProvinceGdp(
                        rs.getString("province"),
                        List.of(rs.getDouble("gdp_2022"), rs.getDouble("gdp_2023"), rs.getDouble("gdp_2024"))))
                .list();
    }
}

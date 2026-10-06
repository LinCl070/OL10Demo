package com.atlasgis.server.web;

import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 前端启动时调用，用于判断使用数据库还是浏览器本地存储。 */
@RestController
public class HealthController {

    private final JdbcClient jdbc;

    public HealthController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/health")
    public Map<String, String> health() {
        String postgis = jdbc.sql("SELECT postgis_lib_version()").query(String.class).single();
        return Map.of("status", "ok", "postgis", postgis);
    }
}

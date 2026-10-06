package com.atlasgis.server.web;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.atlasgis.server.hotspot.HotspotController;
import com.atlasgis.server.marker.MarkerController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

/** 校验错误响应统一为 { "message": "中文原因" }；不连接数据库，JdbcClient 用 Mockito 替身。 */
class ApiErrorResponseTest {

    private JdbcClient jdbc;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        jdbc = Mockito.mock(JdbcClient.class, Answers.RETURNS_DEEP_STUBS);
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mvc = MockMvcBuilders.standaloneSetup(new MarkerController(jdbc), new HotspotController(jdbc))
                .setControllerAdvice(new ApiExceptionHandler())
                .setValidator(validator)
                .build();
    }

    private org.springframework.test.web.servlet.ResultActions postJson(String path, String body) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).characterEncoding("UTF-8").content(body));
    }

    @Test
    void blankMarkerNameReturnsChineseMessage() throws Exception {
        postJson("/api/markers", "{\"name\":\"  \",\"coordinate\":[104,30]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("标注名称不能为空"));
    }

    @Test
    void missingHotspotCoordinatesReturnsChineseMessage() throws Exception {
        postJson("/api/hotspots", "{\"name\":\"热区\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("热区坐标不能为空"));
    }

    @Test
    void tooLongNameReturnsChineseMessage() throws Exception {
        postJson("/api/hotspots", "{\"name\":\"" + "长".repeat(101) + "\",\"coordinates\":[[1,1],[2,2],[3,1]]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("热区名称不能超过 100 个字符"));
    }

    @Test
    void malformedJsonReturnsChineseMessage() throws Exception {
        postJson("/api/markers", "not json")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("请求数据格式错误，应为 JSON"));
    }

    @Test
    void outOfRangeCoordinateReturnsChineseMessage() throws Exception {
        postJson("/api/markers", "{\"name\":\"点\",\"coordinate\":[200,30]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("经度必须在 -180 到 180 之间"));
    }

    @Test
    void deletingMissingRecordReturnsChinese404() throws Exception {
        Mockito.when(jdbc.sql(Mockito.anyString()).param(Mockito.anyString(), Mockito.any()).update()).thenReturn(0);
        mvc.perform(delete("/api/markers/999"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("标注不存在"));
    }
}

package com.atlasgis.server.web;

import java.util.Map;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * 统一错误响应：所有接口出错时都返回 { "message": "中文原因" }，前端直接展示 message。
 * 数据库内部错误只记录日志，不把 SQL 细节返回给浏览器。
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    // 坐标范围、多边形顶点数等业务校验（见 LonLat）。
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> invalidInput(IllegalArgumentException exception) {
        return error(HttpStatus.BAD_REQUEST, exception.getMessage());
    }

    // @NotBlank、@Size 等注解校验失败：返回第一个字段的中文提示（提示文字定义在各请求 record 上）。
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> invalidField(MethodArgumentNotValidException exception) {
        FieldError fieldError = exception.getBindingResult().getFieldError();
        String message = fieldError == null
                ? "提交的数据不合法"
                : Objects.requireNonNullElse(fieldError.getDefaultMessage(), fieldError.getField() + " 不合法");
        return error(HttpStatus.BAD_REQUEST, message);
    }

    // 请求体不是合法 JSON，或字段类型不匹配（如坐标传了字符串）。
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> unreadableBody(HttpMessageNotReadableException exception) {
        return error(HttpStatus.BAD_REQUEST, "请求数据格式错误，应为 JSON");
    }

    // 控制器主动抛出的状态异常，如删除不存在的记录（404）。
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, String>> statusException(ResponseStatusException exception) {
        String message = Objects.requireNonNullElse(exception.getReason(), "请求失败");
        return error(exception.getStatusCode(), message);
    }

    @ExceptionHandler(DataAccessResourceFailureException.class)
    public ResponseEntity<Map<String, String>> databaseUnavailable(DataAccessResourceFailureException exception) {
        log.error("数据库不可用", exception);
        return error(HttpStatus.SERVICE_UNAVAILABLE, "数据库暂不可用");
    }

    // 其余数据库异常多由约束校验或几何解析失败引起，视为请求数据不合法。
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<Map<String, String>> invalidData(DataAccessException exception) {
        log.warn("数据库拒绝了请求数据: {}", exception.getMostSpecificCause().getMessage());
        return error(HttpStatus.BAD_REQUEST, "提交的数据不合法");
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatusCode status, String message) {
        return ResponseEntity.status(status).body(Map.of("message", message));
    }
}

package com.atlasgis.server.geo;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 经纬度校验与 WKT 拼接。
 * 每个坐标都先转换为经过范围校验的 double，再格式化为数字文本，因此拼接出的 WKT 不会被注入任意 SQL。
 */
public final class LonLat {

    private LonLat() {
    }

    /** 校验 [经度, 纬度]，返回 double 数组。 */
    public static double[] require(List<Double> coordinate) {
        // 不可变 List 的 contains(null) 会抛 NPE，因此逐个判断空值。
        if (coordinate == null || coordinate.size() != 2 || coordinate.get(0) == null || coordinate.get(1) == null) {
            throw new IllegalArgumentException("坐标必须是 [经度, 纬度]");
        }
        double longitude = coordinate.get(0);
        double latitude = coordinate.get(1);
        if (!Double.isFinite(longitude) || longitude < -180 || longitude > 180) {
            throw new IllegalArgumentException("经度必须在 -180 到 180 之间");
        }
        if (!Double.isFinite(latitude) || latitude < -90 || latitude > 90) {
            throw new IllegalArgumentException("纬度必须在 -90 到 90 之间");
        }
        return new double[] {longitude, latitude};
    }

    /** 把一个经纬度环转换为 POLYGON WKT；未闭合的环会自动补上首点。 */
    public static String polygonWkt(List<List<Double>> ring) {
        if (ring == null || ring.size() < 3) {
            throw new IllegalArgumentException("多边形至少需要 3 个顶点");
        }
        List<double[]> points = new ArrayList<>(ring.stream().map(LonLat::require).toList());
        double[] first = points.getFirst();
        double[] last = points.getLast();
        if (first[0] != last[0] || first[1] != last[1]) {
            points.add(first);
        }
        if (points.size() < 4) {
            throw new IllegalArgumentException("多边形至少需要 3 个不同的顶点");
        }
        return points.stream()
                .map(point -> format(point[0]) + " " + format(point[1]))
                .collect(Collectors.joining(", ", "POLYGON((", "))"));
    }

    // 避免 Double.toString 产生 1.0E-5 这类科学计数法。
    private static String format(double value) {
        return BigDecimal.valueOf(value).toPlainString();
    }
}

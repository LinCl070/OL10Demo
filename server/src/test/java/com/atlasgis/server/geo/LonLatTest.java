package com.atlasgis.server.geo;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class LonLatTest {

    @Test
    void acceptsValidCoordinate() {
        assertArrayEquals(new double[] {104.06, 30.67}, LonLat.require(List.of(104.06, 30.67)));
    }

    @Test
    void rejectsOutOfRangeOrMalformedCoordinates() {
        assertThrows(IllegalArgumentException.class, () -> LonLat.require(List.of(181.0, 0.0)));
        assertThrows(IllegalArgumentException.class, () -> LonLat.require(List.of(0.0, -91.0)));
        assertThrows(IllegalArgumentException.class, () -> LonLat.require(List.of(Double.NaN, 0.0)));
        assertThrows(IllegalArgumentException.class, () -> LonLat.require(List.of(1.0)));
        assertThrows(IllegalArgumentException.class, () -> LonLat.require(Arrays.asList(1.0, null)));
        assertThrows(IllegalArgumentException.class, () -> LonLat.require(null));
    }

    @Test
    void closesOpenRing() {
        String wkt = LonLat.polygonWkt(List.of(List.of(104.0, 30.0), List.of(105.0, 30.0), List.of(105.0, 31.0)));
        assertEquals("POLYGON((104.0 30.0, 105.0 30.0, 105.0 31.0, 104.0 30.0))", wkt);
    }

    @Test
    void keepsClosedRingAndAvoidsScientificNotation() {
        String wkt = LonLat.polygonWkt(List.of(
                List.of(0.00001, 0.0), List.of(1.0, 0.0), List.of(1.0, 1.0), List.of(0.00001, 0.0)));
        // 已闭合的环不重复补点；极小数值不能出现 1.0E-5 形式。
        assertEquals(4, wkt.split(",").length);
        assertFalse(wkt.contains("E"), wkt);
        assertTrue(wkt.startsWith("POLYGON((0.0000"), wkt);
    }

    @Test
    void rejectsDegenerateRing() {
        assertThrows(IllegalArgumentException.class, () -> LonLat.polygonWkt(List.of(List.of(1.0, 1.0), List.of(2.0, 2.0))));
        assertThrows(IllegalArgumentException.class,
                () -> LonLat.polygonWkt(List.of(List.of(1.0, 1.0), List.of(2.0, 2.0), List.of(1.0, 1.0))));
    }
}

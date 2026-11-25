package com.pcinventory.agent.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InventoryContractTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @TestFactory
    List<DynamicTest> sharedFixtureCases() throws IOException {
        List<DynamicTest> tests = new ArrayList<>();
        for (JsonNode test : fixture("cases")) {
            tests.add(DynamicTest.dynamicTest(test.get("name").asText(), () -> {
                String source = test.get("source").asText();
                boolean computer = source.endsWith("computer");
                JsonNode document = fixture(computer ? source : source + "-report");
                applyChanges(document, test.get("changes"));
                byte[] bytes = JSON.writeValueAsBytes(document);
                JsonNode expectedError = test.get("expected");
                if (expectedError.isNull()) {
                    byte[] serialized = computer
                            ? InventoryContract.writeComputer(InventoryContract.readComputer(bytes))
                            : InventoryContract.writeReport(InventoryContract.readReport(bytes));
                    assertTrue(document.equals((left, right) -> left.isNumber() && right.isNumber()
                            ? left.decimalValue().compareTo(right.decimalValue()) : left.equals(right) ? 0 : 1,
                            JSON.readTree(serialized)), "DTO round trip must preserve the JSON fields and values");
                } else {
                    IllegalArgumentException exception = assertThrows(IllegalArgumentException.class, () -> {
                        if (computer) {
                            InventoryContract.readComputer(bytes);
                        } else {
                            InventoryContract.readReport(bytes);
                        }
                    });
                    assertEquals("Invalid inventory data: " + expectedError.asText(), exception.getMessage());
                }
            }));
        }
        return tests;
    }

    @Test
    void readsDifferentModuleSizesAndRetainsLeadingZeros() throws IOException {
        InventoryReport report = InventoryContract.readReport(JSON.writeValueAsBytes(fixture("pending-report")));
        assertEquals("000123", report.assignment.inventoryNumber);
        assertEquals("010", report.assignment.room);
        assertEquals(Long.valueOf(8L << 30), report.hardware.ramSlots.get(1).capacityBytes);
        assertEquals(Long.valueOf(16L << 30), report.hardware.ramSlots.get(3).capacityBytes);
        assertNull(report.hardware.ramSlots.get(3).speedMtps);
    }

    @Test
    void rejectsOversizedReport() throws IOException {
        JsonNode report = fixture("pending-report");
        ArrayNode disks = (ArrayNode) report.at("/hardware/disks");
        ObjectNode disk = (ObjectNode) disks.get(0);
        String label = String.join("", Collections.nCopies(256, "\uD83D\uDDA5"));
        disk.put("model", label).put("interface", label);
        for (int i = 1; i < 64; i++) {
            disks.add(disk.deepCopy());
        }
        ((ObjectNode) report.get("hardware")).put("storageTotalBytes", 64 * disk.get("capacityBytes").asLong());
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class,
                () -> InventoryContract.readReport(JSON.writeValueAsBytes(report)));
        assertEquals("Invalid inventory data: report exceeds 64 KiB", exception.getMessage());
    }

    private static JsonNode fixture(String name) throws IOException {
        try (InputStream stream = InventoryContractTest.class.getResourceAsStream("/contracts/fixtures/" + name + ".json")) {
            if (stream == null) {
                throw new IOException("Missing contract fixture: " + name);
            }
            return JSON.readTree(stream);
        }
    }

    private static void applyChanges(JsonNode document, JsonNode changes) {
        for (JsonNode change : changes) {
            String path = change.get("path").asText();
            int separator = path.lastIndexOf('/');
            ObjectNode parent = (ObjectNode) document.at(path.substring(0, separator));
            String property = path.substring(separator + 1);
            if (change.has("value")) {
                parent.set(property, change.get("value"));
            } else {
                parent.remove(property);
            }
        }
    }
}

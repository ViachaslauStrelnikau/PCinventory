package com.pcinventory.agent.contract;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;

import java.io.IOException;

public final class InventoryContract {
    private static final String SCHEMA_PREFIX = "https://pcinventory.invalid/contracts/v1/";
    private static final int MAX_REPORT_BYTES = 64 * 1024;
    private static final ObjectMapper JSON = new ObjectMapper()
            .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final SchemaRegistry SCHEMAS = SchemaRegistry.withDefaultDialect(
            SpecificationVersion.DRAFT_2020_12,
            registry -> registry.schemaIdResolvers(resolvers -> resolvers.mapPrefix(SCHEMA_PREFIX, "classpath:contracts/")));
    private static final Schema REPORT = SCHEMAS.getSchema(SchemaLocation.of(SCHEMA_PREFIX + "computer-report.schema.json"));
    private static final Schema COMPUTER = SCHEMAS.getSchema(SchemaLocation.of(SCHEMA_PREFIX + "computer-document.schema.json"));

    private InventoryContract() {
    }

    public static InventoryReport readReport(byte[] json) throws IOException {
        require(json.length <= 2 * MAX_REPORT_BYTES + 32, "report exceeds 64 KiB");
        JsonNode node = checkedJson(json, REPORT);
        checkReportSize(json, (ObjectNode) node);
        InventoryReport report = JSON.treeToValue(node, InventoryReport.class);
        ContractConsistency.checkHardware(report.deviceId, report.hardware);
        require(report.reviewedAt == null || !report.reviewedAt.isBefore(report.submittedAt), "reviewedAt");
        if (report.correction != null) {
            InventoryReport.Correction correction = report.correction;
            ContractConsistency.checkHardware(report.deviceId, correction.hardware);
            require(report.hardware.agentVersion.equals(correction.hardware.agentVersion), "correction agentVersion");
            require(!correction.updatedAt.isBefore(report.submittedAt)
                    && (report.reviewedAt == null || !report.reviewedAt.isBefore(correction.updatedAt)), "correction time");
        }
        return report;
    }

    private static void checkReportSize(byte[] json, ObjectNode node) throws IOException {
        if (!node.has("correction")) {
            require(json.length <= MAX_REPORT_BYTES, "report exceeds 64 KiB");
            return;
        }
        ObjectNode original = node.deepCopy();
        JsonNode correction = original.remove("correction");
        require(JSON.writeValueAsBytes(original).length <= MAX_REPORT_BYTES, "report exceeds 64 KiB");
        require(JSON.writeValueAsBytes(correction).length <= MAX_REPORT_BYTES, "correction exceeds 64 KiB");
    }

    public static ComputerDocument readComputer(byte[] json) throws IOException {
        ComputerDocument computer = JSON.treeToValue(checkedJson(json, COMPUTER), ComputerDocument.class);
        ContractConsistency.checkHardware(computer.deviceId, computer);
        return computer;
    }

    public static byte[] writeReport(InventoryReport report) throws IOException {
        byte[] json = JSON.writeValueAsBytes(report);
        readReport(json);
        return json;
    }

    public static byte[] writeComputer(ComputerDocument computer) throws IOException {
        byte[] json = JSON.writeValueAsBytes(computer);
        readComputer(json);
        return json;
    }

    private static JsonNode checkedJson(byte[] bytes, Schema schema) throws IOException {
        JsonNode node = JSON.readTree(bytes);
        require(node != null && node.isObject() && schema.validate(node).isEmpty(), "JSON Schema");
        return node;
    }

    static void require(boolean valid, String rule) {
        if (!valid) {
            throw new IllegalArgumentException("Invalid inventory data: " + rule);
        }
    }
}

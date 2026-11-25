package com.pcinventory.agent.firebase;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

final class FirestoreWrite {
    private FirestoreWrite() {
    }

    static ObjectNode createReport(ObjectMapper json, String documentName, ObjectNode fields) {
        ObjectNode commit = json.createObjectNode();
        ObjectNode write = commit.putArray("writes").addObject();
        write.putObject("update").put("name", documentName).set("fields", fields(json, fields));
        write.putObject("currentDocument").put("exists", false);
        write.putArray("updateTransforms").addObject().put("fieldPath", "submittedAt")
                .put("setToServerValue", "REQUEST_TIME");
        return commit;
    }

    private static ObjectNode fields(ObjectMapper json, ObjectNode source) {
        ObjectNode encoded = json.createObjectNode();
        source.properties().forEach(field -> encoded.set(field.getKey(), value(json, field.getValue())));
        return encoded;
    }

    private static ObjectNode value(ObjectMapper json, JsonNode source) {
        ObjectNode encoded = json.createObjectNode();
        if (source.isNull()) {
            encoded.putNull("nullValue");
        } else if (source.isTextual()) {
            encoded.put("stringValue", source.textValue());
        } else if (source.isBoolean()) {
            encoded.put("booleanValue", source.booleanValue());
        } else if (source.isIntegralNumber()) {
            encoded.put("integerValue", source.asText());
        } else if (source.isFloatingPointNumber()) {
            encoded.put("doubleValue", source.doubleValue());
        } else if (source.isObject()) {
            encoded.putObject("mapValue").set("fields", fields(json, (ObjectNode) source));
        } else if (source.isArray()) {
            ArrayNode values = encoded.putObject("arrayValue").putArray("values");
            source.forEach(item -> values.add(value(json, item)));
        } else {
            throw new IllegalArgumentException("Unsupported Firestore value");
        }
        return encoded;
    }
}

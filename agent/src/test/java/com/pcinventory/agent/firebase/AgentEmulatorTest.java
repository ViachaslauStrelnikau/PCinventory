package com.pcinventory.agent.firebase;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.pcinventory.agent.contract.InventoryReport;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static com.pcinventory.agent.firebase.FirebaseEmulatorClient.Result.*;
import static com.pcinventory.agent.firebase.FirebaseEmulatorClientTest.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "FIREBASE_AUTH_EMULATOR_HOST", matches = "127\\.0\\.0\\.1:9099")
class AgentEmulatorTest {
    private static final String DOCUMENTS = "/v1/projects/demo-pcinventory/databases/(default)/documents/";

    @Test
    void verifiesRealAuthRulesAndCreateOnlyRetryAfterLostResponse() throws Exception {
        assertEquals("127.0.0.1:8080", System.getenv("FIRESTORE_EMULATOR_HOST"));
        String email = UUID.randomUUID() + "@example.invalid";
        String password = UUID.randomUUID().toString();
        ObjectNode signUp = JSON.createObjectNode().put("email", email).put("password", password)
                .put("returnSecureToken", true);
        Reply account = request(9099, "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-test",
                "POST", signUp, null);
        assertEquals(200, account.status);
        String uid = account.body.path("localId").asText();
        assertFalse(uid.isEmpty());
        ObjectNode role = JSON.createObjectNode();
        ObjectNode fields = role.putObject("fields");
        fields.putObject("role").put("stringValue", "COLLECTOR");
        fields.putObject("enabled").put("booleanValue", true);
        seed("users/" + uid, role);

        InventoryReport report = fixture();
        SubmissionDraft draft = new SubmissionDraft(report.deviceId, report.hardware, report.assignment);
        FirebaseEmulatorClient client = new FirebaseEmulatorClient();
        setIntake(false);
        assertEquals(LOGIN_FAILED, client.submit(draft, email, "invalid-password".toCharArray()));
        assertEquals(ACCESS_DENIED, client.submit(draft, email, password.toCharArray()));
        assertEquals(404, getReport(draft).status);

        setIntake(true);
        assertEquals(SENT, client.submit(draft, email, password.toCharArray()));
        assertEquals(SENT, client.submit(draft, email, password.toCharArray()));
        assertPending(draft, uid);
        assertEquals(404, request(8080, DOCUMENTS + "computers/" + report.deviceId, "GET", null, "Bearer owner").status);

        SubmissionDraft lost = new SubmissionDraft(report.deviceId, report.hardware, report.assignment);
        AtomicInteger forwarded = new AtomicInteger();
        AtomicInteger originalStatus = new AtomicInteger();
        HttpServer proxy = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        proxy.createContext(COMMIT, exchange -> {
            try {
                String token = exchange.getRequestHeaders().getFirst("Authorization");
                Reply result = request(8080, COMMIT, "POST", JSON.readTree(exchange.getRequestBody()), token);
                boolean first = forwarded.incrementAndGet() == 1;
                if (first) {
                    originalStatus.set(result.status);
                }
                byte[] bytes = JSON.writeValueAsBytes(first ? JSON.createObjectNode() : result.body);
                exchange.sendResponseHeaders(first ? 503 : result.status, bytes.length);
                exchange.getResponseBody().write(bytes);
            } finally {
                exchange.close();
            }
        });
        proxy.start();
        try {
            FirebaseEmulatorClient interruptedClient = new FirebaseEmulatorClient(9099, proxy.getAddress().getPort());
            assertEquals(UNCONFIRMED, interruptedClient.submit(lost, email, password.toCharArray()));
            assertEquals(200, originalStatus.get());
            assertEquals(2, forwarded.get());
            assertPending(lost, uid);
            assertEquals(UNCONFIRMED, client.submit(lost, email, password.toCharArray()));
            assertPending(lost, uid);
        } finally {
            proxy.stop(0);
        }

        Reply listing = request(8080, DOCUMENTS + "inventoryReports", "GET", null, "Bearer owner");
        assertEquals(200, listing.status);
        assertEquals(2, listing.body.path("documents").size());
    }

    private static void setIntake(boolean open) throws IOException {
        ObjectNode setting = JSON.createObjectNode();
        setting.putObject("fields").putObject("acceptingReports").put("booleanValue", open);
        seed("settings/inventory", setting);
    }

    private static void seed(String path, ObjectNode document) throws IOException {
        ObjectNode payload = JSON.createObjectNode();
        payload.putArray("writes").addObject().putObject("update")
                .put("name", "projects/demo-pcinventory/databases/(default)/documents/" + path)
                .set("fields", document.path("fields"));
        assertEquals(200, request(8080, COMMIT, "POST", payload, "Bearer owner").status);
    }

    private static Reply getReport(SubmissionDraft draft) throws IOException {
        return request(8080, DOCUMENTS + "inventoryReports/" + draft.reportId(), "GET", null, "Bearer owner");
    }

    private static void assertPending(SubmissionDraft draft, String uid) throws IOException {
        Reply stored = getReport(draft);
        assertEquals(200, stored.status);
        assertEquals("PENDING", stored.body.at("/fields/status/stringValue").asText());
        assertEquals(uid, stored.body.at("/fields/submittedBy/stringValue").asText());
        assertTrue(stored.body.at("/fields/submittedAt/timestampValue").isTextual());
        assertEquals("010", stored.body.at("/fields/assignment/mapValue/fields/room/stringValue").asText());
    }

    private static Reply request(int port, String path, String method, JsonNode content, String authorization)
            throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http", "127.0.0.1", port, path)
                .openConnection(Proxy.NO_PROXY);
        try {
            connection.setRequestMethod(method);
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(15000);
            if (authorization != null) {
                connection.setRequestProperty("Authorization", authorization);
            }
            if (content != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    JSON.writeValue(output, content);
                }
            }
            int status = connection.getResponseCode();
            try (InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream()) {
                JsonNode body = input == null ? JSON.createObjectNode() : JSON.readTree(input);
                return new Reply(status, body);
            }
        } finally {
            connection.disconnect();
        }
    }

    private static final class Reply {
        final int status;
        final JsonNode body;

        Reply(int status, JsonNode body) {
            this.status = status;
            this.body = body;
        }
    }
}

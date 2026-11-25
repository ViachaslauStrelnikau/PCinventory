package com.pcinventory.agent.firebase;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pcinventory.agent.contract.InventoryContract;
import com.pcinventory.agent.contract.InventoryReport;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static com.pcinventory.agent.firebase.FirebaseClient.Result.*;
import static org.junit.jupiter.api.Assertions.*;

class FirebaseEmulatorClientTest {
    static final String OK = "{\"commitTime\":\"2026-01-01T00:00:00Z\","
            + "\"writeResults\":[{\"updateTime\":\"2026-01-01T00:00:00Z\"}]}";
    static final ObjectMapper JSON = new ObjectMapper();
    static final String AUTH = "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
    static final String COMMIT = "/v1/projects/demo-pcinventory/databases/(default)/documents:commit";
    private HttpServer server;
    private FirebaseClient client;
    private final AtomicInteger logins = new AtomicInteger();
    private final List<JsonNode> writes = new ArrayList<>();
    private final List<String> tokens = new ArrayList<>();
    private String uid = "test-collector";
    private int authStatus = 200;
    private int[] commitStatus;
    private String successBody = OK;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(AUTH, this::auth);
        server.createContext(COMMIT, this::commit);
        server.start();
        int port = server.getAddress().getPort();
        client = new FirebaseClient(port, port);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void sendsCreateOnlyWithTypedValuesAndServerTimestamp() throws Exception {
        commitStatus = new int[] {200};
        SubmissionDraft draft = draft();
        char[] secret = "local-only".toCharArray();
        assertEquals(SENT, client.submit(draft, "collector@example.invalid", secret));
        assertArrayEquals(new char[secret.length], secret);
        assertTrue(draft.isSent());
        assertEquals(SENT, submit(draft));
        assertEquals(1, logins.get());
        assertEquals(1, writes.size());
        assertEquals("Bearer token-1", tokens.get(0));

        JsonNode write = writes.get(0).at("/writes/0");
        assertTrue(write.at("/update/name").asText().endsWith("/inventoryReports/" + draft.reportId()));
        assertFalse(write.at("/currentDocument/exists").asBoolean(true));
        assertEquals("submittedAt", write.at("/updateTransforms/0/fieldPath").asText());
        assertEquals("REQUEST_TIME", write.at("/updateTransforms/0/setToServerValue").asText());
        JsonNode fields = write.at("/update/fields");
        assertFalse(fields.has("submittedAt"));
        assertEquals("test-collector", fields.at("/submittedBy/stringValue").asText());
        assertEquals("010", fields.at("/assignment/mapValue/fields/room/stringValue").asText());
        assertEquals("25769803776", fields.at("/hardware/mapValue/fields/ramTotalBytes/integerValue").asText());
        assertEquals(24.0, fields.at("/hardware/mapValue/fields/ramTotalGiB/doubleValue").asDouble());
        assertTrue(fields.at("/hardware/mapValue/fields/motherboardSerial/nullValue").isNull());
        assertEquals(4, fields.at("/hardware/mapValue/fields/ramSlots/arrayValue/values").size());
    }

    @Test
    void retriesSamePayloadAndDoesNotReportSuccessAfterPossibleCommit() throws Exception {
        commitStatus = new int[] {503, 403, 403};
        SubmissionDraft draft = draft();
        assertEquals(UNCONFIRMED, submit(draft));
        assertEquals(UNCONFIRMED, submit(draft));
        assertFalse(draft.isSent());
        assertEquals(3, writes.size());
        assertEquals(writes.get(0), writes.get(1));
        assertEquals(writes.get(1), writes.get(2));
        uid = "other-collector";
        assertEquals(UNCONFIRMED, submit(draft));
        assertEquals(3, writes.size());
    }

    @Test
    void retriesTemporaryFailureAndReauthenticatesOnce() throws Exception {
        commitStatus = new int[] {401, 503, 200};
        assertEquals(SENT, submit(draft()));
        assertEquals(2, logins.get());
        assertEquals("Bearer token-1", tokens.get(0));
        assertEquals("Bearer token-2", tokens.get(2));
        assertEquals(writes.get(0), writes.get(2));
    }

    @Test
    void treatsMissingConfirmationAndPermissionDenialDifferently() throws Exception {
        commitStatus = new int[] {403, 200};
        assertEquals(ACCESS_DENIED, submit(draft()));
        successBody = "{}";
        assertEquals(UNCONFIRMED, submit(draft()));
        assertEquals(2, writes.size());
    }

    @Test
    void stopsOnInvalidPasswordAndInvalidReport() throws Exception {
        authStatus = 400;
        assertEquals(LOGIN_FAILED, submit(draft()));
        assertTrue(writes.isEmpty());
        InventoryReport report = fixture();
        report.assignment.building = " ";
        assertEquals(INVALID_REPORT, submit(new SubmissionDraft(report.deviceId, report.hardware, report.assignment)));
        assertEquals(1, logins.get());
    }

    @Test
    void distinguishesAnUnavailableAuthEndpointFromAnUnconfirmedWrite() throws Exception {
        server.stop(0);
        assertEquals(NETWORK_ERROR, submit(draft()));
        assertTrue(writes.isEmpty());
    }

    private FirebaseClient.Result submit(SubmissionDraft draft) {
        return client.submit(draft, "collector@example.invalid", "local-only".toCharArray());
    }

    private void auth(HttpExchange exchange) throws IOException {
        int count = logins.incrementAndGet();
        JSON.readTree(exchange.getRequestBody());
        if (authStatus == 200) {
            reply(exchange, 200, "{\"localId\":\"" + uid + "\",\"idToken\":\"token-" + count + "\"}");
        } else {
            reply(exchange, authStatus, "{}");
        }
    }

    private void commit(HttpExchange exchange) throws IOException {
        JsonNode body = JSON.readTree(exchange.getRequestBody());
        writes.add(body);
        tokens.add(exchange.getRequestHeaders().getFirst("Authorization"));
        int index = writes.size() - 1;
        int status = commitStatus[index];
        reply(exchange, status, status == 200 ? successBody : "{}");
    }

    private static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try {
            exchange.getResponseBody().write(bytes);
        } finally {
            exchange.close();
        }
    }

    private static SubmissionDraft draft() throws IOException {
        InventoryReport report = fixture();
        return new SubmissionDraft(report.deviceId, report.hardware, report.assignment);
    }

    static InventoryReport fixture() throws IOException {
        try (InputStream stream = FirebaseEmulatorClientTest.class.getResourceAsStream("/contracts/fixtures/pending-report.json")) {
            return InventoryContract.readReport(JSON.writeValueAsBytes(JSON.readTree(stream)));
        }
    }
}

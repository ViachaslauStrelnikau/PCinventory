package com.pcinventory.agent.firebase;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

public final class FirebaseEmulatorClient {
    private static final String DATABASE = "projects/demo-pcinventory/databases/(default)";
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private final int authPort;
    private final int firestorePort;

    public FirebaseEmulatorClient() {
        this(9099, 8080);
    }

    FirebaseEmulatorClient(int authPort, int firestorePort) {
        this.authPort = authPort;
        this.firestorePort = firestorePort;
    }

    public enum Result { SENT, INVALID_REPORT, LOGIN_FAILED, ACCESS_DENIED, NETWORK_ERROR, UNCONFIRMED, CANCELLED }

    public Result submit(SubmissionDraft draft, String email, char[] password) {
        try {
            if (draft.isSent()) {
                return Result.SENT;
            }
            try {
                draft.validate();
            } catch (IOException | IllegalArgumentException exception) {
                return Result.INVALID_REPORT;
            }

            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
            Credentials credentials = signIn(email, password, deadline);
            if (!draft.acceptsUser(credentials.uid)) {
                return Result.UNCONFIRMED;
            }
            ObjectNode fields = draft.pendingFields(credentials.uid);
            byte[] body = JSON.writeValueAsBytes(FirestoreWrite.createReport(JSON,
                    DATABASE + "/documents/inventoryReports/" + draft.reportId(), fields));
            return commit(draft, email, password, credentials, body, deadline);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return Result.CANCELLED;
        } catch (LoginRejected exception) {
            return unresolvedOr(draft, Result.LOGIN_FAILED);
        } catch (IOException exception) {
            return unresolvedOr(draft, Result.NETWORK_ERROR);
        } catch (IllegalArgumentException exception) {
            return Result.INVALID_REPORT;
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    private Result commit(SubmissionDraft draft, String email, char[] password, Credentials credentials,
                          byte[] body, long deadline) throws IOException, LoginRejected, InterruptedException {
        boolean reauthenticated = false;
        for (int attempt = 1; attempt <= 3; attempt++) {
            checkInterrupted();
            Response reply = null;
            try {
                reply = post(firestorePort, "/v1/" + DATABASE + "/documents:commit", body, credentials.token, deadline);
            } catch (BeforeSend exception) {
                // No commit bytes left the client.
            } catch (IOException exception) {
                draft.markUnconfirmed();
            }

            if (reply != null && reply.success()) {
                if (confirmed(reply.body)) {
                    draft.markSent();
                    return Result.SENT;
                }
                draft.markUnconfirmed();
                return Result.UNCONFIRMED;
            }

            if (reply != null && reply.code == 401 && !reauthenticated && attempt < 3) {
                Credentials refreshed = signIn(email, password, deadline);
                if (!credentials.uid.equals(refreshed.uid)) {
                    return unresolvedOr(draft, Result.LOGIN_FAILED);
                }
                credentials = refreshed;
                reauthenticated = true;
                continue;
            }

            if (reply != null && !retryable(reply.code)) {
                if (reply.code == 409 || reply.code == 412
                        || reply.body.at("/error/status").asText().equals("FAILED_PRECONDITION")) {
                    draft.markUnconfirmed();
                }
                return unresolvedOr(draft, reply.code == 400 ? Result.INVALID_REPORT : Result.ACCESS_DENIED);
            }
            if (reply != null && reply.code != 429) {
                draft.markUnconfirmed();
            }
            if (attempt == 3 || !waitToRetry(attempt, reply, deadline)) {
                return unresolvedOr(draft, Result.NETWORK_ERROR);
            }
        }
        return unresolvedOr(draft, Result.NETWORK_ERROR);
    }

    private Credentials signIn(String email, char[] password, long deadline)
            throws IOException, LoginRejected, InterruptedException {
        checkInterrupted();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        try (JsonGenerator generator = JSON.getFactory().createGenerator(buffer)) {
            generator.writeStartObject();
            generator.writeStringField("email", email);
            generator.writeFieldName("password");
            generator.writeString(password, 0, password.length);
            generator.writeBooleanField("returnSecureToken", true);
            generator.writeEndObject();
        }
        byte[] body = buffer.toByteArray();
        try {
            Response response = post(authPort, "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
                    + "?key=demo-pcinventory-local-only", body, null, deadline);
            if (!response.success() && !retryable(response.code)) {
                throw new LoginRejected();
            }
            JsonNode uid = response.body.path("localId");
            JsonNode token = response.body.path("idToken");
            if (!response.success() || !uid.isTextual() || uid.textValue().trim().isEmpty()
                    || !token.isTextual() || token.textValue().trim().isEmpty()) {
                throw new IOException("Invalid local Auth response");
            }
            return new Credentials(uid.textValue(), token.textValue());
        } finally {
            Arrays.fill(body, (byte) 0);
        }
    }

    private static Response post(int port, String path, byte[] body, String token, long deadline) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http", "127.0.0.1", port, path)
                .openConnection(Proxy.NO_PROXY);
        try {
            connection.setRequestMethod("POST");
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            if (token != null) {
                connection.setRequestProperty("Authorization", "Bearer " + token);
            }
            try {
                connection.setConnectTimeout(timeout(deadline, 5000));
                connection.setReadTimeout(timeout(deadline, 15000));
                connection.connect();
            } catch (IOException exception) {
                throw new BeforeSend();
            }
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
            int code = connection.getResponseCode();
            String retryAfter = connection.getHeaderField("Retry-After");
            if (code < 200 || code >= 300) {
                try {
                    return new Response(code, readBody(connection.getErrorStream(), deadline), retryAfter);
                } catch (IOException exception) {
                    // A known HTTP rejection remains a rejection even if its error body is unavailable.
                    return new Response(code, JSON.createObjectNode(), retryAfter);
                }
            }
            return new Response(code, readBody(connection.getInputStream(), deadline), retryAfter);
        } finally {
            connection.disconnect();
        }
    }

    private static JsonNode readBody(InputStream input, long deadline) throws IOException {
        if (input == null) {
            return JSON.createObjectNode();
        }
        try (InputStream response = input) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int count;
            while ((count = response.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_RESPONSE_BYTES || deadline - System.nanoTime() <= 0) {
                    throw new IOException("Local response limit exceeded");
                }
                bytes.write(buffer, 0, count);
            }
            JsonNode result = JSON.readTree(bytes.toByteArray());
            return result == null ? JSON.createObjectNode() : result;
        }
    }

    private static boolean confirmed(JsonNode response) {
        JsonNode writes = response.path("writeResults");
        if (!writes.isArray() || writes.size() != 1) {
            return false;
        }
        try {
            Instant.parse(response.path("commitTime").asText());
            Instant.parse(writes.path(0).path("updateTime").asText());
            return true;
        } catch (DateTimeParseException exception) {
            return false;
        }
    }

    private static boolean retryable(int code) {
        return code == 408 || code == 429 || code == 500 || code == 502 || code == 503 || code == 504;
    }

    private static boolean waitToRetry(int attempt, Response response, long deadline) throws InterruptedException {
        long delay = attempt * 1000L + ThreadLocalRandom.current().nextLong(150);
        if (response != null && response.retryAfter != null) {
            delay = Math.max(delay, retryAfterMillis(response.retryAfter));
        }
        if (delay >= TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())) {
            return false;
        }
        Thread.sleep(delay);
        return true;
    }

    private static long retryAfterMillis(String header) {
        try {
            return TimeUnit.SECONDS.toMillis(Long.parseLong(header.trim()));
        } catch (NumberFormatException exception) {
            try {
                return ZonedDateTime.parse(header, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
                        - System.currentTimeMillis();
            } catch (DateTimeParseException ignored) {
                return 0;
            }
        }
    }

    private static int timeout(long deadline, int maxMillis) throws IOException {
        long remaining = deadline - System.nanoTime();
        if (remaining <= 0) {
            throw new IOException("Local request deadline reached");
        }
        return (int) Math.max(1, Math.min(maxMillis, TimeUnit.NANOSECONDS.toMillis(remaining)));
    }

    private static void checkInterrupted() throws InterruptedException {
        if (Thread.currentThread().isInterrupted()) {
            throw new InterruptedException();
        }
    }

    private static Result unresolvedOr(SubmissionDraft draft, Result result) {
        return draft.hasUnconfirmedWrite() ? Result.UNCONFIRMED : result;
    }

    private static final class Response {
        final int code;
        final JsonNode body;
        final String retryAfter;

        Response(int code, JsonNode body, String retryAfter) {
            this.code = code;
            this.body = body;
            this.retryAfter = retryAfter;
        }

        boolean success() {
            return code >= 200 && code < 300;
        }
    }

    private static final class Credentials {
        final String uid;
        final String token;

        Credentials(String uid, String token) {
            this.uid = uid;
            this.token = token;
        }
    }

    private static final class LoginRejected extends Exception {
    }

    private static final class BeforeSend extends IOException {
    }
}

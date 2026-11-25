package com.pcinventory.agent.firebase;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;

public final class CollectorAccount {
    public final FirebaseClient client;
    public final String email;
    private final char[] password;

    private CollectorAccount(FirebaseClient client, String email, String password) {
        this.client = client;
        this.email = email;
        this.password = password.toCharArray();
    }

    public static CollectorAccount load(boolean emulator) throws IOException {
        if (emulator) {
            String email = System.getenv("PCINVENTORY_COLLECTOR_EMAIL");
            String password = System.getenv("PCINVENTORY_COLLECTOR_PASSWORD");
            return email == null || email.trim().isEmpty() || password == null || password.isEmpty()
                    ? null : new CollectorAccount(new FirebaseClient(), email.trim(), password);
        }
        try (InputStream input = CollectorAccount.class.getResourceAsStream("/agent-collector.json")) {
            if (input == null) return null;
            JsonNode config = new ObjectMapper().readTree(input);
            if (config == null || !config.isObject()) throw new IOException("Invalid collector configuration");
            String email = config.path("email").asText("").trim();
            String password = config.path("password").asText("");
            if (email.isEmpty() || password.isEmpty()) throw new IOException("Invalid collector account");
            FirebaseClient client = FirebaseClient.cloud(config.path("projectId").asText(""), config.path("apiKey").asText(""));
            return new CollectorAccount(client, email, password);
        }
    }

    public char[] passwordCopy() {
        return password.clone();
    }

    public void clear() {
        Arrays.fill(password, '\0');
    }
}

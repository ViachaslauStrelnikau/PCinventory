package com.pcinventory.agent.collector;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

final class DeviceIdentity {
    private static final Pattern UUID_FORMAT = Pattern.compile(
            "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}");
    private static final Set<String> PLACEHOLDERS = new HashSet<>(Arrays.asList(
            "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
            "03000200-0400-0500-0006-000700080009", "00020003-0004-0005-0006-000700080009",
            "01234567-89ab-cdef-0123-456789abcdef", "12345678-1234-1234-1234-123456789abc"));

    private DeviceIdentity() {
    }

    static synchronized String loadOrCreate(Path directory, String firmwareUuid) throws IOException {
        Files.createDirectories(directory);
        Path identity = directory.resolve("device-id");
        try (FileChannel channel = FileChannel.open(directory.resolve("device-id.lock"),
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             FileLock lock = channel.lock()) {
            if (Files.exists(identity)) {
                if (Files.size(identity) > 64) {
                    throw new IOException("Invalid device ID");
                }
                String saved = new String(Files.readAllBytes(identity), StandardCharsets.US_ASCII).trim();
                if (!validSavedId(saved)) {
                    throw new IOException("Invalid device ID");
                }
                return saved;
            }

            String uuid = firmwareUuid == null ? "" : firmwareUuid.trim().toLowerCase(Locale.ROOT);
            if (uuid.startsWith("{") && uuid.endsWith("}")) {
                uuid = uuid.substring(1, uuid.length() - 1);
            }
            String selected = validUuid(uuid) ? "smbios-" + uuid : "local-" + UUID.randomUUID();
            Path temporary = Files.createTempFile(directory, "device-id-", ".tmp");
            try {
                Files.write(temporary, selected.getBytes(StandardCharsets.US_ASCII));
                Files.move(temporary, identity, StandardCopyOption.ATOMIC_MOVE);
            } finally {
                Files.deleteIfExists(temporary);
            }
            return selected;
        }
    }

    private static boolean validSavedId(String saved) {
        if (saved.startsWith("smbios-")) {
            return validUuid(saved.substring(7));
        }
        return saved.startsWith("local-") && validUuid(saved.substring(6));
    }

    private static boolean validUuid(String uuid) {
        return UUID_FORMAT.matcher(uuid).matches() && !PLACEHOLDERS.contains(uuid);
    }
}

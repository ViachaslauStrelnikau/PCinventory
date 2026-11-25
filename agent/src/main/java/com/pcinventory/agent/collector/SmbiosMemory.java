package com.pcinventory.agent.collector;

import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.win32.StdCallLibrary;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class SmbiosMemory {
    private static final int RAW_SMBIOS = 0x52534D42; // RSMB
    private static final int HEADER_SIZE = 8;

    private interface FirmwareApi extends StdCallLibrary {
        int GetSystemFirmwareTable(int provider, int table, Pointer buffer, int size);
    }

    private final String locator;
    private final String bank;
    private final long capacity;
    final int ratedMtps;
    final int configuredMtps;

    private SmbiosMemory(String locator, String bank, long capacity, int ratedMtps, int configuredMtps) {
        this.locator = locator;
        this.bank = bank;
        this.capacity = capacity;
        this.ratedMtps = ratedMtps;
        this.configuredMtps = configuredMtps;
    }

    static List<SmbiosMemory> read() {
        FirmwareApi api = Native.load("kernel32", FirmwareApi.class);
        int size = api.GetSystemFirmwareTable(RAW_SMBIOS, 0, null, 0);
        if (size < HEADER_SIZE || size > 16 * 1024 * 1024) {
            return Collections.emptyList();
        }
        try (Memory buffer = new Memory(size)) {
            int written = api.GetSystemFirmwareTable(RAW_SMBIOS, 0, buffer, size);
            return written == size ? parse(buffer.getByteArray(0, size)) : Collections.emptyList();
        }
    }

    static List<SmbiosMemory> parse(byte[] raw) {
        if (raw.length < HEADER_SIZE) {
            return Collections.emptyList();
        }
        int version = Byte.toUnsignedInt(raw[1]) * 256 + Byte.toUnsignedInt(raw[2]);
        // SMBIOS revisions through 3.0 described MHz, although some firmware stored MT/s.
        if (version < 0x0301) {
            return Collections.emptyList();
        }
        ByteBuffer data = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        int tableSize = data.getInt(4);
        if (tableSize < 0 || tableSize > raw.length - HEADER_SIZE) {
            return Collections.emptyList();
        }

        int end = HEADER_SIZE + tableSize;
        List<SmbiosMemory> modules = new ArrayList<>();
        for (int start = HEADER_SIZE; start + 4 <= end; ) {
            int type = Byte.toUnsignedInt(raw[start]);
            int length = Byte.toUnsignedInt(raw[start + 1]);
            int strings = start + length;
            if (type == 127) {
                break;
            }
            if (length < 4 || strings >= end) {
                return Collections.emptyList();
            }
            int terminator = strings;
            while (terminator + 1 < end && (raw[terminator] != 0 || raw[terminator + 1] != 0)) {
                terminator++;
            }
            if (terminator + 1 >= end) {
                return Collections.emptyList();
            }
            if (type == 17 && length >= 0x13) {
                long capacity = capacity(data, start, length);
                String locator = stringAt(raw, strings, terminator, raw[start + 0x10]);
                String bank = stringAt(raw, strings, terminator, raw[start + 0x11]);
                if (capacity > 0 && !locator.isEmpty()) {
                    boolean extended = version >= 0x0303;
                    modules.add(new SmbiosMemory(locator, bank, capacity,
                            speed(data, start, length, 0x15, 0x54, extended),
                            speed(data, start, length, 0x20, 0x58, extended)));
                }
            }
            start = terminator + 2;
        }
        return modules;
    }

    static SmbiosMemory match(List<SmbiosMemory> modules, String locator, String bank, long capacity) {
        SmbiosMemory match = null;
        for (SmbiosMemory module : modules) {
            if (module.capacity == capacity && module.locator.equalsIgnoreCase(locator)
                    && module.bank.equalsIgnoreCase(bank == null ? "" : bank)) {
                if (match != null) {
                    return null;
                }
                match = module;
            }
        }
        return match;
    }

    private static long capacity(ByteBuffer data, int start, int length) {
        int size = Short.toUnsignedInt(data.getShort(start + 0x0c));
        if (size == 0xffff) {
            return 0;
        }
        if (size == 0x7fff) {
            return length >= 0x20 ? (data.getInt(start + 0x1c) & 0x7fffffffL) << 20 : 0;
        }
        return (size & 0x8000) != 0 ? (long) (size & 0x7fff) << 10 : (long) size << 20;
    }

    private static int speed(ByteBuffer data, int start, int length, int offset, int extendedOffset,
                             boolean extended) {
        if (length < offset + 2) {
            return 0;
        }
        int value = Short.toUnsignedInt(data.getShort(start + offset));
        if (value != 0xffff) {
            return value;
        }
        int extendedValue = extended && length >= extendedOffset + 4
                ? data.getInt(start + extendedOffset) : 0;
        return extendedValue >= 0xffff ? extendedValue : 0;
    }

    private static String stringAt(byte[] raw, int start, int end, byte index) {
        int wanted = Byte.toUnsignedInt(index);
        for (int current = 1; start < end; current++) {
            int stop = start;
            while (stop < end && raw[stop] != 0) {
                stop++;
            }
            if (current == wanted) {
                return new String(raw, start, stop - start, StandardCharsets.UTF_8).trim();
            }
            start = stop + 1;
        }
        return "";
    }
}

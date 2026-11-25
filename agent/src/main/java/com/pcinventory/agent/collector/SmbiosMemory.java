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
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class SmbiosMemory {
    private static final int RAW_SMBIOS = 0x52534D42; // RSMB
    private static final int HEADER_SIZE = 8;

    private interface FirmwareApi extends StdCallLibrary {
        int GetSystemFirmwareTable(int provider, int table, Pointer buffer, int size);
    }

    final String locator;
    final String bank;
    final long capacity;
    final int ratedMtps;
    final int configuredMtps;
    final int arrayHandle;
    final int memoryType;
    final int formFactor;
    final boolean empty;

    private SmbiosMemory(String locator, String bank, long capacity, int ratedMtps, int configuredMtps,
                         int arrayHandle, int memoryType, int formFactor, boolean empty) {
        this.locator = locator;
        this.bank = bank;
        this.capacity = capacity;
        this.ratedMtps = ratedMtps;
        this.configuredMtps = configuredMtps;
        this.arrayHandle = arrayHandle;
        this.memoryType = memoryType;
        this.formFactor = formFactor;
        this.empty = empty;
    }

    static List<SmbiosMemory> read() {
        FirmwareApi api = Native.load("kernel32", FirmwareApi.class);
        int size = api.GetSystemFirmwareTable(RAW_SMBIOS, 0, null, 0);
        if (size < HEADER_SIZE || size > 16 * 1024 * 1024) {
            throw new IllegalStateException("Invalid SMBIOS table size");
        }
        try (Memory buffer = new Memory(size)) {
            int written = api.GetSystemFirmwareTable(RAW_SMBIOS, 0, buffer, size);
            if (written != size) {
                throw new IllegalStateException("Incomplete SMBIOS table");
            }
            return parse(buffer.getByteArray(0, size));
        }
    }

    static List<SmbiosMemory> parse(byte[] raw) {
        if (raw.length < HEADER_SIZE) {
            return Collections.emptyList();
        }
        int version = Byte.toUnsignedInt(raw[1]) * 256 + Byte.toUnsignedInt(raw[2]);
        ByteBuffer data = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN);
        int tableSize = data.getInt(4);
        if (tableSize < 0 || tableSize > raw.length - HEADER_SIZE) {
            return Collections.emptyList();
        }

        int end = HEADER_SIZE + tableSize;
        List<SmbiosMemory> modules = new ArrayList<>();
        Set<Integer> systemArrays = new HashSet<>();
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
            if (type == 16 && length >= 0x0f && raw[start + 5] == 3) {
                systemArrays.add(Short.toUnsignedInt(data.getShort(start + 2)));
            } else if (type == 17 && length >= 0x13) {
                long capacity = capacity(data, start, length);
                String locator = stringAt(raw, strings, terminator, raw[start + 0x10]);
                String bank = stringAt(raw, strings, terminator, raw[start + 0x11]);
                // Older tables described speed in MHz and some vendors stored MT/s instead.
                boolean mtps = version >= 0x0301;
                boolean extended = version >= 0x0303;
                modules.add(new SmbiosMemory(locator, bank, capacity,
                        mtps ? speed(data, start, length, 0x15, 0x54, extended) : 0,
                        mtps ? speed(data, start, length, 0x20, 0x58, extended) : 0,
                        Short.toUnsignedInt(data.getShort(start + 4)), Byte.toUnsignedInt(raw[start + 0x12]),
                        Byte.toUnsignedInt(raw[start + 0x0e]), data.getShort(start + 0x0c) == 0));
            }
            start = terminator + 2;
        }
        modules.removeIf(module -> !systemArrays.contains(module.arrayHandle));
        return modules;
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

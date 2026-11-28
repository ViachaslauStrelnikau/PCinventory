package com.pcinventory.agent.collector;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

final class HardwareNormalization {
    private HardwareNormalization() {
    }

    static String text(Object value) {
        String text = value == null ? "" : value.toString().trim();
        if (text.isEmpty() || "unknown".equalsIgnoreCase(text) || "none".equalsIgnoreCase(text)
                || "To Be Filled By O.E.M.".equalsIgnoreCase(text)
                || "Default string".equalsIgnoreCase(text) || "Not Specified".equalsIgnoreCase(text)) {
            return null;
        }
        return text;
    }

    static String cpuModel(String raw) {
        return raw == null ? null : text(raw.replaceAll("(?i)\\((?:R|TM)\\)", "")
                .replaceFirst("(?i)\\s+@?\\s*\\d+(?:[.,]\\d+)?\\s*[GM]Hz\\s*$", "")
                .replaceAll("\\s+", " "));
    }

    static boolean staticIpv4(InetAddress address) {
        return address instanceof Inet4Address && !address.isLoopbackAddress() && !address.isLinkLocalAddress()
                && !address.isAnyLocalAddress() && !address.isMulticastAddress()
                && (address.getAddress()[0] & 0xff) < 240 && address.getAddress()[0] != 0;
    }

    static String networkMode(List<Boolean> dhcpFlags) {
        boolean dhcp = dhcpFlags.contains(Boolean.TRUE);
        boolean fixed = dhcpFlags.contains(Boolean.FALSE);
        if (dhcp && fixed) {
            return "MIXED";
        }
        if (dhcpFlags.contains(null) || (!dhcp && !fixed)) {
            return "UNKNOWN";
        }
        return dhcp ? "DHCP" : "STATIC";
    }

    static void memory(HardwareSnapshot snapshot, List<SmbiosMemory> firmware, boolean arraysKnown) {
        int occupied = snapshot.modules.size();
        long total = 0;
        boolean capacitiesKnown = occupied > 0;
        boolean socketed = occupied > 0;
        boolean matchedAll = occupied > 0;
        if (occupied == 0) {
            snapshot.warnings.add("Модули ОЗУ не определены");
        }
        for (HardwareSnapshot.MemoryModule module : snapshot.modules) {
            capacitiesKnown &= module.capacity > 0;
            total += module.capacity;
            SmbiosMemory entry = match(module, snapshot.modules, firmware);
            matchedAll &= entry != null;
            if (entry != null) {
                module.ratedMtps = entry.ratedMtps;
                module.configuredMtps = entry.configuredMtps;
                module.memoryType = memoryType(entry.memoryType, module.memoryType);
                if (entry.formFactor != 0 && entry.formFactor != 2) {
                    module.formFactor = formFactor(entry.formFactor);
                }
            }
            socketed &= "DIMM".equals(module.formFactor) || "SO-DIMM".equals(module.formFactor)
                    || "SIMM".equals(module.formFactor);
        }

        long firmwareOccupied = firmware.stream().filter(entry -> !entry.empty).count();
        boolean conflict = (arraysKnown && snapshot.slotsTotal < occupied)
                || (!firmware.isEmpty() && firmwareOccupied != occupied)
                || (arraysKnown && firmware.size() > snapshot.slotsTotal)
                || (capacitiesKnown && total < snapshot.visibleMemory);
        if (conflict) {
            snapshot.memorySourceConflict = true;
            snapshot.warnings.add("Источники расходятся по объёму или слотам ОЗУ");
        }
        if (!arraysKnown || snapshot.slotsTotal < occupied) {
            snapshot.slotsTotal = 0;
        }
        if (capacitiesKnown && !conflict) {
            snapshot.installedMemory = total;
        } else if (snapshot.visibleMemory > 0) {
            snapshot.warnings.add("Показан объём ОЗУ, видимый операционной системе");
        }

        Set<String> knownTypes = snapshot.modules.stream().map(module -> module.memoryType)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        if (knownTypes.size() > 1) {
            snapshot.ramType = "MIXED";
        } else if (knownTypes.size() == 1 && snapshot.modules.stream().noneMatch(module -> module.memoryType == null)) {
            snapshot.ramType = knownTypes.iterator().next();
        }

        boolean labelsComplete = firmware.stream().allMatch(entry -> text(entry.locator) != null
                && firmware.stream().filter(other -> samePosition(entry, other)).count() == 1);
        boolean emptyEntriesSocketed = firmware.stream().filter(entry -> entry.empty)
                .allMatch(entry -> entry.formFactor == 9 || entry.formFactor == 13 || entry.formFactor == 3);
        if (!conflict && matchedAll && labelsComplete && firmware.size() == snapshot.slotsTotal
                && socketed && emptyEntriesSocketed) {
            for (SmbiosMemory entry : firmware) {
                if (entry.empty) {
                    snapshot.modules.add(new HardwareSnapshot.MemoryModule(text(entry.locator), text(entry.bank),
                            0, null, null, null, false));
                }
            }
            snapshot.ramSlotTopology = "COMPLETE";
        } else if (occupied > 0 || snapshot.slotsTotal > 0) {
            snapshot.ramSlotTopology = "PARTIAL";
        }
        if (occupied > 0 && !conflict) {
            snapshot.slotsUsed = occupied;
        }
        if (snapshot.slotsUsed != null && snapshot.slotsTotal >= occupied && socketed && emptyEntriesSocketed) {
            snapshot.slotsFree = snapshot.slotsTotal - occupied;
        } else if (snapshot.slotsTotal > 0 && occupied > 0) {
            snapshot.warnings.add("Число свободных разъёмов ОЗУ определить не удалось");
        }
    }

    private static SmbiosMemory match(HardwareSnapshot.MemoryModule module,
                                      List<HardwareSnapshot.MemoryModule> modules, List<SmbiosMemory> firmware) {
        if (module.slotId == null || module.capacity <= 0 || modules.stream().filter(other ->
                module.capacity == other.capacity && sameLabel(module.slotId, other.slotId)
                        && sameLabel(module.bankLabel, other.bankLabel)).count() != 1) {
            return null;
        }
        SmbiosMemory matched = null;
        for (SmbiosMemory entry : firmware) {
            if (entry.capacity == module.capacity && sameLabel(module.slotId, text(entry.locator))
                    && sameLabel(module.bankLabel, text(entry.bank))) {
                if (matched != null) {
                    return null;
                }
                matched = entry;
            }
        }
        return matched;
    }

    private static boolean samePosition(SmbiosMemory first, SmbiosMemory second) {
        return sameLabel(text(first.locator), text(second.locator))
                && sameLabel(text(first.bank), text(second.bank));
    }

    private static boolean sameLabel(String first, String second) {
        return first == null ? Objects.isNull(second) : first.equalsIgnoreCase(second);
    }

    static String memoryType(int type, String fallback) {
        switch (type) {
            case 0x12: return "DDR";
            case 0x13: return "DDR2";
            case 0x14: return "DDR2 FB-DIMM";
            case 0x18: return "DDR3";
            case 0x1a: return "DDR4";
            case 0x1b: return "LPDDR";
            case 0x1c: return "LPDDR2";
            case 0x1d: return "LPDDR3";
            case 0x1e: return "LPDDR4";
            case 0x22: return "DDR5";
            case 0x23: return "LPDDR5";
            default: return fallback;
        }
    }

    static String cimMemoryType(long type) {
        switch ((int) type) {
            case 20: return "DDR";
            case 21: return "DDR2";
            case 22: return "DDR2 FB-DIMM";
            case 24: return "DDR3";
            case 26: return "DDR4";
            default: return null;
        }
    }

    static String formFactor(int type) {
        switch (type) {
            case 3: return "SIMM";
            case 5: return "Chip";
            case 9: return "DIMM";
            case 13: return "SO-DIMM";
            case 16: return "Die";
            default: return null;
        }
    }

    static String cimFormFactor(long type) {
        switch ((int) type) {
            case 8: return "DIMM";
            case 12: return "SO-DIMM";
            case 7: return "SIMM";
            case 4: return "Chip";
            default: return null;
        }
    }

    static String diskSerial(Object value) {
        String serial = text(value);
        return serial == null || serial.matches("[0\\s-]+") ? null : serial.toUpperCase(Locale.ROOT);
    }

    static String diskType(long mediaType) {
        return mediaType == 3 ? "HDD" : mediaType == 4 ? "SSD" : "UNKNOWN";
    }

    static Long diskNumber(Object value) {
        if (value == null) return null;
        try {
            long number = Long.parseLong(value.toString());
            return number >= 0 && number < 0xffff_ffffL ? number : null;
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    static String diskInterface(String legacy, long numberedBus, long physicalBus) {
        String bus = diskBus(numberedBus);
        if (bus == null) bus = diskBus(physicalBus);
        if (bus != null) return bus;
        // The legacy IDE label can describe a SATA disk as well as an IDE disk.
        return "IDE".equalsIgnoreCase(legacy) ? null : legacy;
    }

    static String diskBus(long type) {
        switch ((int) type) {
            case 1: return "SCSI";
            case 3: return "ATA";
            case 8: return "RAID";
            case 10: return "SAS";
            case 11: return "SATA";
            case 17: return "NVMe";
            default: return null;
        }
    }
}

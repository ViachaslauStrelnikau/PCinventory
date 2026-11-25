package com.pcinventory.agent.collector;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class HardwareSnapshot {
    public final RuntimeProbe runtime = RuntimeProbe.read();
    public final List<String> warnings = new ArrayList<>();
    public final List<Gpu> gpus = new ArrayList<>();
    public final List<MemoryModule> modules = new ArrayList<>();
    public final List<Disk> disks = new ArrayList<>();
    public final List<Network> networks = new ArrayList<>();
    public final Set<String> staticIpv4 = new LinkedHashSet<>();
    public String hostname;
    public String os;
    public String osFamily;
    public String osVersion;
    public String osBuild;
    public int osBitness;
    public String osCaption;
    public String computerVendor;
    public String computerModel;
    public String cpuModelRaw;
    public String cpuModel;
    public String cpuVendor;
    public int physicalCores;
    public int logicalThreads;
    public String boardVendor;
    public String boardModel;
    public String boardSerial;
    public String deviceId;
    public String networkMode = "UNKNOWN";
    public long visibleMemory;
    public long installedMemory;
    public int slotsTotal;
    public Integer slotsUsed;
    public Integer slotsFree;
    public String ramSlotTopology = "UNKNOWN";
    public String ramType = "UNKNOWN";
    public Boolean hasSsd;
    public int modulesWithSpeed;

    public List<String> diagnosticLines() {
        List<String> lines = new ArrayList<>();
        Collections.addAll(lines, runtime.toString(), "OSHI OS: " + os,
                "CPU available: " + (cpuModel != null), "CPU cores/threads: " + physicalCores + "/" + logicalThreads,
                "Baseboard available: " + (boardModel != null),
                "OSHI visible RAM bytes: " + visibleMemory, "WMI installed RAM bytes: " + installedMemory,
                "WMI memory places: " + slotsTotal, "RAM slots used: " + slotsUsed,
                "RAM slots free: " + slotsFree, "RAM topology: " + ramSlotTopology, "RAM type: " + ramType,
                "WMI modules with Speed: " + modulesWithSpeed,
                "WMI graphics controllers: " + gpus.size(), "WMI disk candidates: " + disks.size(),
                "Known SSD present: " + hasSsd, "WMI network mode: " + networkMode,
                "Static IPv4 count: " + staticIpv4.size(), "Device ID source: "
                        + (deviceId == null ? "unavailable" : deviceId.startsWith("smbios-") ? "SMBIOS" : "local"),
                "Warnings: " + warnings);
        for (MemoryModule module : modules) {
            if (module.occupied) {
                lines.add("SMBIOS module: configured=" + module.configuredMtps + ", rated="
                        + module.ratedMtps + " MT/s (0 = unavailable)");
            }
        }
        for (Disk disk : disks) {
            lines.add("Disk: " + disk.type + ", bus=" + disk.connection + ", bytes=" + disk.capacity);
        }
        return lines;
    }

    public static final class MemoryModule {
        public final String slotId;
        public final String bankLabel;
        public final long capacity;
        public final String manufacturer;
        public final String partNumber;
        public final boolean occupied;
        public String memoryType;
        public String formFactor;
        public int ratedMtps;
        public int configuredMtps;

        MemoryModule(String slotId, String bankLabel, long capacity, String manufacturer,
                     String partNumber, String memoryType, boolean occupied) {
            this.slotId = slotId;
            this.bankLabel = bankLabel;
            this.capacity = capacity;
            this.manufacturer = manufacturer;
            this.partNumber = partNumber;
            this.memoryType = memoryType;
            this.occupied = occupied;
        }
    }

    public static final class Gpu {
        public final String name;
        public final String vendor;

        Gpu(String name, String vendor) {
            this.name = name;
            this.vendor = vendor;
        }
    }

    public static final class Network {
        public final String name;
        public final String mode;
        public final Set<String> staticIpv4;

        Network(String name, String mode, Set<String> staticIpv4) {
            this.name = name;
            this.mode = mode;
            this.staticIpv4 = Collections.unmodifiableSet(staticIpv4);
        }
    }

    public static final class Disk {
        public final String name;
        public final String connection;
        public final long capacity;
        public final String type;

        Disk(String name, String connection, long capacity, String type) {
            this.name = name;
            this.connection = connection;
            this.capacity = capacity;
            this.type = type;
        }
    }
}

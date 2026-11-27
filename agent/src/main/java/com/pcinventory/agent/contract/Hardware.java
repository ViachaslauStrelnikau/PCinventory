package com.pcinventory.agent.contract;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public class Hardware {
    public int schemaVersion;
    public String agentVersion;
    public IdentitySource identitySource;
    public String hostname;

    public String cpuManufacturer;
    public String cpuModel;
    public String cpuModelRaw;
    public Integer cpuCores;
    public Integer cpuThreads;
    public String motherboardManufacturer;
    public String motherboardModel;
    public String motherboardSerial;
    public String computerManufacturer;
    public String computerModel;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public DeviceType deviceType;
    public String osName;
    public String osVersion;
    public String osBuild;
    public String osArchitecture;

    public List<String> gpuModels;
    public List<Gpu> gpus;

    public Long ramTotalBytes;
    public Double ramTotalGiB;
    public String ramType;
    public Integer ramSlotsTotal;
    public Integer ramSlotsUsed;
    public Integer ramSlotsFree;
    public RamSlotTopology ramSlotTopology;
    public List<RamSlot> ramSlots;

    public Long storageTotalBytes;
    public Boolean hasSsd;
    public List<Disk> disks;
    public NetworkMode networkMode;
    public List<String> staticIpv4;
    public List<NetworkAdapter> networks;
    public List<WarningCode> warnings;

    public enum IdentitySource { SMBIOS, LOCAL, MANUAL }
    public enum DeviceType { LAPTOP, DESKTOP, UNKNOWN }
    public enum RamSlotTopology { COMPLETE, PARTIAL, UNKNOWN }
    public enum DiskType { SSD, HDD, UNKNOWN }
    public enum NetworkMode { DHCP, STATIC, MIXED, UNKNOWN }
    public enum AdapterMode { DHCP, STATIC, UNKNOWN }

    public enum WarningCode {
        CPU_ATTRIBUTES_UNAVAILABLE, SYSTEM_ATTRIBUTES_UNAVAILABLE, OS_ATTRIBUTES_UNAVAILABLE,
        GPU_ATTRIBUTES_UNAVAILABLE, RAM_MODULES_UNAVAILABLE, RAM_CAPACITY_OS_VISIBLE,
        RAM_SLOT_TOPOLOGY_PARTIAL, RAM_SOURCE_CONFLICT, RAM_SPEED_UNAVAILABLE, DISK_ATTRIBUTES_UNAVAILABLE,
        DISK_TYPES_UNAVAILABLE, NETWORK_MODE_UNAVAILABLE, NETWORK_ADAPTER_UNCLASSIFIED,
        STATIC_IPV4_UNAVAILABLE, IDENTITY_PROFILE_FALLBACK
    }

    public static final class Gpu {
        public String model;
        public String manufacturer;
        public Long vramBytes;
    }

    public static final class RamSlot {
        public String slotId;
        public String bankLabel;
        public Boolean occupied;
        public Long capacityBytes;
        public String memoryType;
        public Integer speedMtps;
        public Integer configuredSpeedMtps;
        public String manufacturer;
        public String partNumber;
        public String formFactor;
    }

    public static final class Disk {
        public String model;
        public DiskType type;
        public Long capacityBytes;
        @JsonProperty("interface")
        public String diskInterface;
    }

    public static final class NetworkAdapter {
        public String name;
        public AdapterMode mode;
        public List<String> staticIpv4;
    }
}

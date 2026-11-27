package com.pcinventory.agent.collector;

import com.pcinventory.agent.contract.Hardware;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

import static com.pcinventory.agent.collector.HardwareNormalization.text;
import static com.pcinventory.agent.contract.Hardware.WarningCode.*;

public final class HardwareReport {
    private HardwareReport() {
    }

    public static boolean canSubmit(HardwareSnapshot snapshot) {
        return snapshot.deviceId != null && snapshot.hostname != null
                && (snapshot.cpuModel != null || snapshot.physicalCores > 0)
                && (snapshot.installedMemory > 0 || snapshot.visibleMemory > 0)
                && !snapshot.disks.isEmpty() && snapshot.networkSourcesAvailable;
    }

    public static Hardware from(HardwareSnapshot snapshot) {
        Hardware hardware = new Hardware();
        hardware.schemaVersion = 1;
        String version = HardwareReport.class.getPackage().getImplementationVersion();
        hardware.agentVersion = version == null ? "0.1.0-SNAPSHOT" : version;
        hardware.identitySource = snapshot.deviceId.startsWith("smbios-")
                ? Hardware.IdentitySource.SMBIOS : Hardware.IdentitySource.LOCAL;
        hardware.hostname = snapshot.hostname;
        hardware.cpuManufacturer = snapshot.cpuVendor;
        hardware.cpuModel = snapshot.cpuModel;
        hardware.cpuModelRaw = snapshot.cpuModelRaw;
        hardware.cpuCores = positive(snapshot.physicalCores);
        hardware.cpuThreads = positive(snapshot.logicalThreads);
        hardware.motherboardManufacturer = snapshot.boardVendor;
        hardware.motherboardModel = snapshot.boardModel;
        hardware.motherboardSerial = snapshot.boardSerial;
        hardware.computerManufacturer = snapshot.computerVendor;
        hardware.computerModel = snapshot.computerModel;
        hardware.deviceType = snapshot.deviceType;
        hardware.osName = snapshot.osCaption == null ? snapshot.osFamily : snapshot.osCaption;
        hardware.osVersion = snapshot.osVersion;
        hardware.osBuild = snapshot.osBuild;
        hardware.osArchitecture = snapshot.osBitness == 64 ? "x64" : snapshot.osBitness == 32 ? "x86" : null;

        hardware.gpus = snapshot.gpus.stream().map(HardwareReport::gpu).collect(Collectors.toList());
        hardware.gpuModels = hardware.gpus.stream().map(gpu -> gpu.model).filter(Objects::nonNull)
                .distinct().collect(Collectors.toList());
        hardware.ramTotalBytes = positive(snapshot.installedMemory > 0 ? snapshot.installedMemory : snapshot.visibleMemory);
        hardware.ramTotalGiB = hardware.ramTotalBytes == null ? null : hardware.ramTotalBytes / 1073741824.0;
        hardware.ramType = snapshot.ramType;
        hardware.ramSlotsTotal = positive(snapshot.slotsTotal);
        hardware.ramSlotsUsed = snapshot.slotsUsed;
        hardware.ramSlotsFree = snapshot.slotsFree;
        hardware.ramSlotTopology = Hardware.RamSlotTopology.valueOf(snapshot.ramSlotTopology);
        hardware.ramSlots = snapshot.modules.stream().map(HardwareReport::slot).collect(Collectors.toList());

        hardware.disks = snapshot.disks.stream().map(HardwareReport::disk).collect(Collectors.toList());
        hardware.storageTotalBytes = !hardware.disks.isEmpty() && hardware.disks.stream().allMatch(disk -> disk.capacityBytes != null)
                ? hardware.disks.stream().mapToLong(disk -> disk.capacityBytes).sum() : null;
        hardware.hasSsd = snapshot.hasSsd;
        hardware.networkMode = Hardware.NetworkMode.valueOf(snapshot.networkMode);
        hardware.staticIpv4 = new ArrayList<>(snapshot.staticIpv4);
        hardware.networks = snapshot.networks.stream().map(HardwareReport::network).collect(Collectors.toList());
        hardware.warnings = warnings(snapshot, hardware);
        return hardware;
    }

    private static Hardware.Gpu gpu(HardwareSnapshot.Gpu source) {
        Hardware.Gpu gpu = new Hardware.Gpu();
        gpu.model = source.name;
        gpu.manufacturer = source.vendor;
        return gpu;
    }

    private static Hardware.RamSlot slot(HardwareSnapshot.MemoryModule source) {
        Hardware.RamSlot slot = new Hardware.RamSlot();
        slot.slotId = source.slotId;
        slot.bankLabel = source.bankLabel;
        slot.occupied = source.occupied;
        if (source.occupied) {
            slot.capacityBytes = positive(source.capacity);
            slot.memoryType = source.memoryType;
            slot.manufacturer = text(source.manufacturer);
            slot.partNumber = text(source.partNumber);
            slot.formFactor = source.formFactor;
            slot.speedMtps = positive(source.ratedMtps);
            slot.configuredSpeedMtps = positive(source.configuredMtps);
        }
        return slot;
    }

    private static Hardware.Disk disk(HardwareSnapshot.Disk source) {
        Hardware.Disk disk = new Hardware.Disk();
        disk.model = source.name;
        disk.type = Hardware.DiskType.valueOf(source.type);
        disk.capacityBytes = positive(source.capacity);
        disk.diskInterface = source.connection;
        return disk;
    }

    private static Hardware.NetworkAdapter network(HardwareSnapshot.Network source) {
        Hardware.NetworkAdapter network = new Hardware.NetworkAdapter();
        network.name = source.name;
        network.mode = Hardware.AdapterMode.valueOf(source.mode);
        network.staticIpv4 = new ArrayList<>(source.staticIpv4);
        return network;
    }

    private static List<Hardware.WarningCode> warnings(HardwareSnapshot snapshot, Hardware hardware) {
        List<Hardware.WarningCode> warnings = new ArrayList<>();
        if (hardware.cpuManufacturer == null || hardware.cpuModel == null
                || hardware.cpuCores == null || hardware.cpuThreads == null) {
            warnings.add(CPU_ATTRIBUTES_UNAVAILABLE);
        }
        if (hardware.motherboardModel == null || hardware.computerModel == null) {
            warnings.add(SYSTEM_ATTRIBUTES_UNAVAILABLE);
        }
        if (hardware.osName == null || hardware.osArchitecture == null || hardware.osBuild == null) {
            warnings.add(OS_ATTRIBUTES_UNAVAILABLE);
        }
        if (hardware.gpus.isEmpty() || hardware.gpus.stream().anyMatch(gpu -> gpu.vramBytes == null)) {
            warnings.add(GPU_ATTRIBUTES_UNAVAILABLE);
        }
        if (hardware.ramSlots.isEmpty()) {
            warnings.add(RAM_MODULES_UNAVAILABLE);
        }
        if (snapshot.installedMemory <= 0 && snapshot.visibleMemory > 0) {
            warnings.add(RAM_CAPACITY_OS_VISIBLE);
        }
        if (hardware.ramSlotTopology != Hardware.RamSlotTopology.COMPLETE) {
            warnings.add(RAM_SLOT_TOPOLOGY_PARTIAL);
        }
        if (snapshot.memorySourceConflict) {
            warnings.add(RAM_SOURCE_CONFLICT);
        }
        if (hardware.ramSlots.stream().anyMatch(slot -> Boolean.TRUE.equals(slot.occupied)
                && slot.speedMtps == null && slot.configuredSpeedMtps == null)) {
            warnings.add(RAM_SPEED_UNAVAILABLE);
        }
        if (hardware.disks.stream().anyMatch(disk -> disk.capacityBytes == null || disk.model == null || disk.diskInterface == null)) {
            warnings.add(DISK_ATTRIBUTES_UNAVAILABLE);
        }
        if (hardware.disks.stream().anyMatch(disk -> disk.type == Hardware.DiskType.UNKNOWN)) {
            warnings.add(DISK_TYPES_UNAVAILABLE);
        }
        if (snapshot.unclassifiedNetworkAdapter) {
            warnings.add(NETWORK_ADAPTER_UNCLASSIFIED);
        }
        if (hardware.networkMode == Hardware.NetworkMode.UNKNOWN) {
            warnings.add(NETWORK_MODE_UNAVAILABLE);
        }
        if (hardware.networks.stream().anyMatch(network -> network.mode == Hardware.AdapterMode.STATIC && network.staticIpv4.isEmpty())) {
            warnings.add(STATIC_IPV4_UNAVAILABLE);
        }
        if (hardware.identitySource == Hardware.IdentitySource.LOCAL) {
            warnings.add(IDENTITY_PROFILE_FALLBACK);
        }
        return warnings;
    }

    private static Integer positive(int value) {
        return value > 0 ? value : null;
    }

    private static Long positive(long value) {
        return value > 0 ? value : null;
    }
}

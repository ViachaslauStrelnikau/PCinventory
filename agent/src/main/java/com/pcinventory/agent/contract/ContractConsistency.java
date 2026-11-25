package com.pcinventory.agent.contract;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static com.pcinventory.agent.contract.InventoryContract.require;

final class ContractConsistency {
    private ContractConsistency() {
    }

    static void checkHardware(String deviceId, Hardware hardware) {
        require(deviceId.startsWith(hardware.identitySource.name().toLowerCase(Locale.ROOT) + "-"), "identitySource");
        require(hardware.cpuCores == null || hardware.cpuThreads == null
                || hardware.cpuCores <= hardware.cpuThreads, "CPU counts");
        List<String> models = hardware.gpus.stream().map(gpu -> gpu.model).filter(Objects::nonNull)
                .distinct().collect(Collectors.toList());
        require(models.equals(hardware.gpuModels), "gpuModels");
        checkMemory(hardware);
        checkStorage(hardware);
        checkNetwork(hardware);
    }

    private static void checkMemory(Hardware hardware) {
        Double gib = hardware.ramTotalBytes == null ? null : hardware.ramTotalBytes / 1073741824.0;
        require(Objects.equals(gib, hardware.ramTotalGiB), "ramTotalGiB");

        Integer total = hardware.ramSlotsTotal;
        Integer used = hardware.ramSlotsUsed;
        Integer free = hardware.ramSlotsFree;
        long occupied = hardware.ramSlots.stream().filter(slot -> Boolean.TRUE.equals(slot.occupied)).count();
        long empty = hardware.ramSlots.stream().filter(slot -> Boolean.FALSE.equals(slot.occupied)).count();
        require((total == null || hardware.ramSlots.size() <= total)
                && (used == null || used == occupied)
                && (free == null || (total != null && used != null && free == total - used && free >= empty)), "RAM slot counts");

        if (hardware.ramSlotTopology == Hardware.RamSlotTopology.COMPLETE) {
            Set<List<String>> labels = new HashSet<>();
            require(total != null && used != null && free != null && total == hardware.ramSlots.size()
                    && hardware.ramSlots.stream().allMatch(slot -> slot.slotId != null && slot.occupied != null
                            && labels.add(Arrays.asList(lower(slot.slotId), lower(slot.bankLabel)))), "complete RAM topology");
        }
    }

    private static String lower(String value) {
        return value == null ? null : value.toLowerCase(Locale.ROOT);
    }

    private static void checkStorage(Hardware hardware) {
        boolean anySsd = hardware.disks.stream().anyMatch(disk -> disk.type == Hardware.DiskType.SSD);
        boolean allHdd = !hardware.disks.isEmpty()
                && hardware.disks.stream().allMatch(disk -> disk.type == Hardware.DiskType.HDD);
        Boolean hasSsd = anySsd ? Boolean.TRUE : allHdd ? Boolean.FALSE : null;
        require(Objects.equals(hasSsd, hardware.hasSsd), "hasSsd");

        Long storageTotal = null;
        if (!hardware.disks.isEmpty() && hardware.disks.stream().allMatch(disk -> disk.capacityBytes != null)) {
            storageTotal = hardware.disks.stream().mapToLong(disk -> disk.capacityBytes).sum();
        }
        require(Objects.equals(storageTotal, hardware.storageTotalBytes), "storageTotalBytes");
    }

    private static void checkNetwork(Hardware hardware) {
        boolean dhcp = hardware.networks.stream().anyMatch(adapter -> adapter.mode == Hardware.AdapterMode.DHCP);
        boolean fixed = hardware.networks.stream().anyMatch(adapter -> adapter.mode == Hardware.AdapterMode.STATIC);
        boolean unknown = hardware.warnings.contains(Hardware.WarningCode.NETWORK_ADAPTER_UNCLASSIFIED)
                || hardware.networks.stream().anyMatch(adapter -> adapter.mode == Hardware.AdapterMode.UNKNOWN);
        Hardware.NetworkMode expected = Hardware.NetworkMode.UNKNOWN;
        if (dhcp && fixed) {
            expected = Hardware.NetworkMode.MIXED;
        } else if (!unknown && (dhcp || fixed)) {
            expected = dhcp ? Hardware.NetworkMode.DHCP : Hardware.NetworkMode.STATIC;
        }
        require(hardware.networkMode == expected, "networkMode");
        Set<String> addresses = hardware.networks.stream().flatMap(adapter -> adapter.staticIpv4.stream())
                .collect(Collectors.toSet());
        require(addresses.equals(new HashSet<>(hardware.staticIpv4)), "staticIpv4");
    }
}

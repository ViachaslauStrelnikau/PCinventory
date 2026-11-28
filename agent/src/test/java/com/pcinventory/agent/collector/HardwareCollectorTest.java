package com.pcinventory.agent.collector;

import com.pcinventory.agent.contract.Hardware.DeviceType;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.InetAddress;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class HardwareCollectorTest {
    private static final long EIGHT_GIB = 8L << 30;
    private static final String UUID = "6c021ce0-b1a0-4680-8780-f210f00f0001";

    @Test
    void normalizesCpuWithoutDroppingModelSuffix() {
        assertEquals("Intel Core i7-12700K", HardwareNormalization.cpuModel(" Intel(R)  Core(TM) i7-12700K @ 3.60 GHz "));
    }

    @Test
    void classifiesReportedDeviceTypeWithoutGuessingOtherSystems() {
        assertEquals(DeviceType.DESKTOP, WindowsHardwareSource.deviceType(1));
        assertEquals(DeviceType.LAPTOP, WindowsHardwareSource.deviceType(2));
        for (int type : new int[] {0, 3, 4, 8}) {
            assertNull(WindowsHardwareSource.deviceType(type));
        }
        HardwareSnapshot result = snapshot(0);
        result.deviceId = "smbios-" + UUID;
        result.deviceType = DeviceType.LAPTOP;
        assertEquals(DeviceType.LAPTOP, HardwareReport.from(result).deviceType);
    }

    @Test
    void classifiesNetworkWithMissingInputsAndFiltersNonAddresses() throws Exception {
        assertEquals("DHCP", HardwareNormalization.networkMode(Collections.singletonList(true)));
        assertEquals("STATIC", HardwareNormalization.networkMode(Collections.singletonList(false)));
        assertEquals("MIXED", HardwareNormalization.networkMode(Arrays.asList(false, null, true)));
        assertEquals("UNKNOWN", HardwareNormalization.networkMode(Arrays.asList(true, null)));
        assertEquals("UNKNOWN", HardwareNormalization.networkMode(Collections.emptyList()));
        for (String address : Arrays.asList("127.0.0.1", "169.254.4.5", "0.0.0.0", "::1", "224.0.0.1", "255.255.255.255")) {
            assertFalse(HardwareNormalization.staticIpv4(InetAddress.getByName(address)), address);
        }
        assertTrue(HardwareNormalization.staticIpv4(InetAddress.getByName("192.0.2.105")));
    }

    @Test
    void keepsKnownSlotsAndIgnoresVideoMemoryArray() {
        List<SmbiosMemory> firmware = firmware(1, false, 0x1a);
        assertEquals(2, firmware.size());
        HardwareSnapshot result = snapshot(2);
        HardwareNormalization.memory(result, firmware, true);

        assertEquals(EIGHT_GIB, result.installedMemory);
        assertEquals("DDR4", result.ramType);
        assertEquals("COMPLETE", result.ramSlotTopology);
        assertEquals(Integer.valueOf(1), result.slotsFree);
        assertEquals(3200, result.modules.get(0).configuredMtps);
        assertEquals("A2", result.modules.get(1).slotId);
        assertFalse(result.modules.get(1).occupied);
    }

    @Test
    void omitsAmbiguousSpeedAndKeepsInstalledModule() {
        List<SmbiosMemory> firmware = firmware(0, false, 0x1a);
        assertEquals(0, firmware.get(0).configuredMtps);
        HardwareSnapshot result = snapshot(2);
        HardwareNormalization.memory(result, Collections.emptyList(), true);

        assertEquals("PARTIAL", result.ramSlotTopology);
        assertEquals(Integer.valueOf(1), result.slotsFree);
        assertEquals(1, result.modules.size());
        assertEquals(0, result.modules.get(0).configuredMtps);
    }

    @Test
    void keepsFreeCountUnknownWhenWmiAndSmbiosDisagree() {
        HardwareSnapshot result = snapshot(1);
        HardwareNormalization.memory(result, firmware(1, false, 0x1a), true);
        assertNull(result.slotsFree);
        assertNull(result.slotsUsed);
        assertEquals(1, result.modules.size());
    }

    @Test
    void keepsFreeCountUnknownForSolderedMemory() {
        HardwareSnapshot result = snapshot(2);
        HardwareNormalization.memory(result, firmware(1, true, 0x1a), true);
        assertNull(result.slotsFree);
        assertEquals("PARTIAL", result.ramSlotTopology);
        assertEquals(1, result.modules.size());
    }

    @Test
    void pinsFallbackWhenFirmwareBecomesAvailable(@TempDir Path directory) throws IOException {
        String id = DeviceIdentity.loadOrCreate(directory, "00000000-0000-0000-0000-000000000000");
        assertTrue(id.startsWith("local-"));
        assertEquals(id, DeviceIdentity.loadOrCreate(directory, UUID));
    }

    @Test
    void pinsNormalizedFirmwareIdAndPreservesBrokenFile(@TempDir Path directory) throws IOException {
        assertEquals("smbios-" + UUID, DeviceIdentity.loadOrCreate(directory,
                "{6C021CE0-B1A0-4680-8780-F210F00F0001}"));
        assertEquals("smbios-" + UUID, DeviceIdentity.loadOrCreate(directory, null));
        Path identity = directory.resolve("device-id");
        Files.write(identity, "broken".getBytes(StandardCharsets.US_ASCII));
        assertThrows(IOException.class, () -> DeviceIdentity.loadOrCreate(directory, UUID));
        assertEquals("broken", new String(Files.readAllBytes(identity), StandardCharsets.US_ASCII));
    }

    @Test
    void acceptsOnlyDocumentedSsdAndHddMediaCodes() {
        assertEquals("HDD", HardwareNormalization.diskType(3));
        assertEquals("SSD", HardwareNormalization.diskType(4));
        assertEquals("UNKNOWN", HardwareNormalization.diskType(0));
        assertEquals("UNKNOWN", HardwareNormalization.diskType(5));
        assertEquals("NVMe", HardwareNormalization.diskBus(17));
        assertEquals("SATA", HardwareNormalization.diskBus(11));
    }

    @Test
    void usesNumberedStorageBusWithoutTreatingLegacyIdeAsSata() {
        assertEquals(Long.valueOf(0), HardwareNormalization.diskNumber(0));
        assertEquals(Long.valueOf(2), HardwareNormalization.diskNumber("2"));
        assertNull(HardwareNormalization.diskNumber(null));
        assertNull(HardwareNormalization.diskNumber(-1));
        assertNull(HardwareNormalization.diskNumber(0xffff_ffffL));
        assertNull(HardwareNormalization.diskNumber("unknown"));
        assertEquals("SATA", HardwareNormalization.diskInterface("IDE", 11, 0));
        assertEquals("SATA", HardwareNormalization.diskInterface("IDE", 11, 3));
        assertEquals("SATA", HardwareNormalization.diskInterface("IDE", 0, 11));
        assertEquals("ATA", HardwareNormalization.diskInterface("IDE", 3, 0));
        assertEquals("SCSI", HardwareNormalization.diskInterface("SCSI", 0, 0));
        assertEquals("NVMe", HardwareNormalization.diskInterface("SCSI", 17, 0));
        assertNull(HardwareNormalization.diskInterface("IDE", 0, 0));
    }

    private static HardwareSnapshot snapshot(int slots) {
        HardwareSnapshot result = new HardwareSnapshot();
        result.slotsTotal = slots;
        HardwareSnapshot.MemoryModule module =
                new HardwareSnapshot.MemoryModule("A1", "BANK 0", EIGHT_GIB, null, null, null, true);
        module.formFactor = "DIMM";
        result.modules.add(module);
        return result;
    }

    private static List<SmbiosMemory> firmware(int minorVersion, boolean soldered, int memoryType) {
        ByteBuffer bytes = ByteBuffer.allocate(256).order(ByteOrder.LITTLE_ENDIAN);
        bytes.put(1, (byte) 3).put(2, (byte) minorVersion).position(8);
        writeArray(bytes, 1, 3);
        writeArray(bytes, 2, 4);
        writeMemory(bytes, 1, 8192, "A1", soldered ? 16 : 9, memoryType);
        writeMemory(bytes, 1, 0, "A2", 9, 0);
        writeMemory(bytes, 2, 8192, "GPU", 9, memoryType);
        bytes.put(new byte[] {127, 4, 0, 0, 0, 0});
        bytes.putInt(4, bytes.position() - 8);
        return SmbiosMemory.parse(Arrays.copyOf(bytes.array(), bytes.position()));
    }

    private static void writeArray(ByteBuffer bytes, int handle, int use) {
        int start = bytes.position();
        bytes.put((byte) 16).put((byte) 15).putShort((short) handle).put((byte) 0).put((byte) use);
        bytes.position(start + 17);
    }

    private static void writeMemory(ByteBuffer bytes, int array, int size, String label, int form, int type) {
        int start = bytes.position();
        bytes.put((byte) 17).put((byte) 0x22).putShort((short) start).putShort((short) array);
        bytes.putShort(start + 0x0c, (short) size).put(start + 0x0e, (byte) form);
        bytes.put(start + 0x10, (byte) 1).put(start + 0x11, (byte) 2).put(start + 0x12, (byte) type);
        bytes.putShort(start + 0x15, (short) 3200).putShort(start + 0x20, (short) 3200);
        bytes.position(start + 0x22);
        bytes.put(label.getBytes(StandardCharsets.US_ASCII)).put((byte) 0);
        bytes.put("BANK 0".getBytes(StandardCharsets.US_ASCII)).putShort((short) 0);
    }
}

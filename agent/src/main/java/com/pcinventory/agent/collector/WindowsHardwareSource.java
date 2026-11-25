package com.pcinventory.agent.collector;

import com.sun.jna.platform.win32.COM.WbemcliUtil.WmiQuery;
import com.sun.jna.platform.win32.COM.WbemcliUtil.WmiResult;
import oshi.SystemInfo;
import oshi.hardware.Baseboard;
import oshi.hardware.CentralProcessor;
import oshi.hardware.ComputerSystem;
import oshi.software.os.OperatingSystem;
import oshi.util.platform.windows.WmiQueryHandler;

import java.io.IOException;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

import static com.pcinventory.agent.collector.HardwareNormalization.text;

public final class WindowsHardwareSource implements HardwareSource {
    private enum MemoryArray { USE, MEMORYDEVICES }
    private enum Memory { DEVICELOCATOR, BANKLABEL, CAPACITY, MANUFACTURER, SPEED, MEMORYTYPE, PARTNUMBER, FORMFACTOR }
    private enum Video { NAME, ADAPTERCOMPATIBILITY }
    private enum DiskDrive { MODEL, SIZE, INTERFACETYPE, MEDIATYPE, PNPDEVICEID, SERIALNUMBER }
    private enum PhysicalDisk { SERIALNUMBER, MEDIATYPE, BUSTYPE, SIZE }
    private enum Product { UUID }
    private enum WindowsEdition { CAPTION }
    private enum Adapter { INDEX, INTERFACEINDEX, PNPDEVICEID, NETCONNECTIONID }
    private enum NetworkConfig { INDEX, DHCPENABLED }

    @Override
    public HardwareSnapshot read() {
        return new Scan().read();
    }

    private static final class Scan {
        private final HardwareSnapshot snapshot = new HardwareSnapshot();
        private String firmwareUuid;

        HardwareSnapshot read() {
            if (!System.getProperty("os.name").startsWith("Windows")) {
                snapshot.warnings.add("Windows");
                return snapshot;
            }
            snapshot.hostname = text(System.getenv("COMPUTERNAME"));
            readOshi();
            readWmi();
            readIdentity();
            return snapshot;
        }

        private void readOshi() {
            SystemInfo system = attempt("OSHI", SystemInfo::new, null);
            if (system == null) {
                return;
            }
            snapshot.os = attempt("OSHI/OS", () -> {
                OperatingSystem platform = system.getOperatingSystem();
                snapshot.osFamily = text(platform.getFamily());
                snapshot.osVersion = text(platform.getVersionInfo().getVersion());
                snapshot.osBuild = text(platform.getVersionInfo().getBuildNumber());
                snapshot.osBitness = platform.getBitness();
                return platform + " · " + platform.getBitness() + "-bit";
            }, null);
            attempt("OSHI/CPU", () -> {
                CentralProcessor processor = system.getHardware().getProcessor();
                snapshot.cpuModelRaw = text(processor.getProcessorIdentifier().getName());
                snapshot.cpuModel = HardwareNormalization.cpuModel(snapshot.cpuModelRaw);
                snapshot.cpuVendor = text(processor.getProcessorIdentifier().getVendor());
                snapshot.physicalCores = processor.getPhysicalProcessorCount();
                snapshot.logicalThreads = processor.getLogicalProcessorCount();
                return null;
            }, null);
            attempt("OSHI/плата", () -> {
                ComputerSystem computer = system.getHardware().getComputerSystem();
                snapshot.computerVendor = text(computer.getManufacturer());
                snapshot.computerModel = text(computer.getModel());
                Baseboard board = computer.getBaseboard();
                snapshot.boardVendor = text(board.getManufacturer());
                snapshot.boardModel = text(board.getModel());
                snapshot.boardSerial = text(board.getSerialNumber());
                return null;
            }, null);
            snapshot.visibleMemory = attempt("OSHI/RAM", () -> system.getHardware().getMemory().getTotal(), 0L);
        }

        private void readWmi() {
            WmiQueryHandler handler = attempt("WMI/COM", WmiQueryHandler::createInstance, null);
            if (handler == null) {
                return;
            }
            Boolean initialized = attempt("WMI/COM", handler::initCOM, null);
            if (initialized == null) {
                return;
            }
            try {
                WmiResult<Product> products = query("Win32_ComputerSystemProduct", Product.class);
                firmwareUuid = count(products) == 1 ? text(products.getValue(Product.UUID, 0)) : null;
                WmiResult<WindowsEdition> editions = query("Win32_OperatingSystem", WindowsEdition.class);
                snapshot.osCaption = count(editions) == 1 ? text(editions.getValue(WindowsEdition.CAPTION, 0)) : null;
                readMemory();
                readGraphics();
                readDisks();
                readNetwork();
            } finally {
                if (initialized) {
                    handler.unInitCOM();
                }
            }
        }

        private void readIdentity() {
            String profile = text(System.getenv("LOCALAPPDATA"));
            if (profile != null) {
                try {
                    snapshot.deviceId = DeviceIdentity.loadOrCreate(Paths.get(profile, "ComputerInventory"), firmwareUuid);
                } catch (IOException | RuntimeException exception) {
                    snapshot.warnings.add("Не удалось сохранить идентификатор компьютера");
                    return;
                }
            }
            if (snapshot.deviceId == null) {
                snapshot.warnings.add("Локальный профиль для идентификатора компьютера недоступен");
            } else if (snapshot.deviceId.startsWith("local-")) {
                snapshot.warnings.add("Используется идентификатор профиля Windows");
            }
        }

        private void readMemory() {
            WmiResult<MemoryArray> arrays = query("Win32_PhysicalMemoryArray", MemoryArray.class);
            boolean arraysKnown = false;
            boolean invalidArray = false;
            for (int row = 0; row < count(arrays); row++) {
                if (positive(arrays.getValue(MemoryArray.USE, row)) == 3) {
                    long places = positive(arrays.getValue(MemoryArray.MEMORYDEVICES, row));
                    invalidArray |= places == 0 || places > 65535;
                    arraysKnown = true;
                    if (places <= 65535) {
                        snapshot.slotsTotal += (int) places;
                    }
                }
            }

            WmiResult<Memory> memory = query("Win32_PhysicalMemory", Memory.class);
            List<SmbiosMemory> firmware = attempt("SMBIOS/RAM", SmbiosMemory::read, Collections.emptyList());
            for (int row = 0; row < count(memory); row++) {
                long capacity = positive(memory.getValue(Memory.CAPACITY, row));
                String locator = text(memory.getValue(Memory.DEVICELOCATOR, row));
                String bank = text(memory.getValue(Memory.BANKLABEL, row));
                if (positive(memory.getValue(Memory.SPEED, row)) > 0) {
                    snapshot.modulesWithSpeed++;
                }
                HardwareSnapshot.MemoryModule module = new HardwareSnapshot.MemoryModule(locator, bank, capacity,
                        text(memory.getValue(Memory.MANUFACTURER, row)), text(memory.getValue(Memory.PARTNUMBER, row)),
                        HardwareNormalization.cimMemoryType(positive(memory.getValue(Memory.MEMORYTYPE, row))), true);
                module.formFactor = HardwareNormalization.cimFormFactor(positive(memory.getValue(Memory.FORMFACTOR, row)));
                snapshot.modules.add(module);
            }
            HardwareNormalization.memory(snapshot, firmware, arraysKnown && !invalidArray);
        }

        private void readGraphics() {
            WmiResult<Video> controllers = query("Win32_VideoController", Video.class);
            for (int row = 0; row < count(controllers); row++) {
                snapshot.gpus.add(new HardwareSnapshot.Gpu(text(controllers.getValue(Video.NAME, row)),
                        text(controllers.getValue(Video.ADAPTERCOMPATIBILITY, row))));
            }
            if (snapshot.gpus.isEmpty() || snapshot.gpus.stream().anyMatch(gpu -> gpu.name == null)) {
                snapshot.warnings.add("Модель видеокарты недоступна");
            }
        }

        private void readDisks() {
            WmiResult<DiskDrive> drives = query("Win32_DiskDrive", DiskDrive.class);
            WmiResult<PhysicalDisk> physical = query("ROOT\\Microsoft\\Windows\\Storage",
                    "MSFT_PhysicalDisk", PhysicalDisk.class);
            Map<String, Integer> diskSerialCounts = new HashMap<>();
            for (int row = 0; row < count(drives); row++) {
                String serial = HardwareNormalization.diskSerial(drives.getValue(DiskDrive.SERIALNUMBER, row));
                if (serial != null) {
                    diskSerialCounts.merge(serial, 1, Integer::sum);
                }
            }
            for (int row = 0; row < count(drives); row++) {
                String name = text(drives.getValue(DiskDrive.MODEL, row));
                String connection = text(drives.getValue(DiskDrive.INTERFACETYPE, row));
                String media = text(drives.getValue(DiskDrive.MEDIATYPE, row));
                String hardwareId = text(drives.getValue(DiskDrive.PNPDEVICEID, row));
                long capacity = positive(drives.getValue(DiskDrive.SIZE, row));
                if ("USB".equalsIgnoreCase(connection) || (hardwareId != null
                        && hardwareId.toUpperCase(Locale.ROOT).startsWith("USBSTOR\\"))
                        || (media != null && media.toLowerCase(Locale.ROOT).contains("removable"))) {
                    continue;
                }
                String serial = HardwareNormalization.diskSerial(drives.getValue(DiskDrive.SERIALNUMBER, row));
                int match = diskSerialCounts.getOrDefault(serial, 0) == 1 ? matchDisk(physical, serial) : -1;
                String type = "UNKNOWN";
                if (match >= 0) {
                    long busType = positive(physical.getValue(PhysicalDisk.BUSTYPE, match));
                    if (busType == 4 || busType == 7 || busType == 9 || busType == 15 || busType == 16) {
                        continue;
                    }
                    String bus = HardwareNormalization.diskBus(busType);
                    if (bus != null) {
                        connection = bus;
                    }
                    long physicalSize = positive(physical.getValue(PhysicalDisk.SIZE, match));
                    capacity = physicalSize > 0 ? physicalSize : capacity;
                    type = HardwareNormalization.diskType(positive(physical.getValue(PhysicalDisk.MEDIATYPE, match)));
                }
                snapshot.disks.add(new HardwareSnapshot.Disk(name, connection, capacity, type));
            }
            if (snapshot.disks.stream().anyMatch(disk -> "SSD".equals(disk.type))) {
                snapshot.hasSsd = true;
            } else if (!snapshot.disks.isEmpty() && snapshot.disks.stream().allMatch(disk -> "HDD".equals(disk.type))) {
                snapshot.hasSsd = false;
            }
            if (snapshot.disks.isEmpty() || snapshot.disks.stream().anyMatch(disk -> "UNKNOWN".equals(disk.type))) {
                snapshot.warnings.add("Тип одного или нескольких накопителей недоступен");
            }
        }

        private int matchDisk(WmiResult<PhysicalDisk> physical, String serial) {
            int match = -1;
            for (int row = 0; row < count(physical); row++) {
                if (serial.equals(HardwareNormalization.diskSerial(physical.getValue(PhysicalDisk.SERIALNUMBER, row)))) {
                    if (match >= 0) {
                        return -1;
                    }
                    match = row;
                }
            }
            return match;
        }

        private void readNetwork() {
            WmiResult<Adapter> adapters = query(
                    "Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE AND NetConnectionStatus = 2", Adapter.class);
            WmiResult<NetworkConfig> configurations = query(
                    "Win32_NetworkAdapterConfiguration WHERE IPEnabled = TRUE", NetworkConfig.class);
            snapshot.networkSourcesAvailable = adapters != null && configurations != null;
            Map<Object, Object> dhcpByIndex = new HashMap<>();
            for (int row = 0; row < count(configurations); row++) {
                dhcpByIndex.put(configurations.getValue(NetworkConfig.INDEX, row),
                        configurations.getValue(NetworkConfig.DHCPENABLED, row));
            }
            List<Boolean> dhcpFlags = new ArrayList<>();
            for (int row = 0; row < count(adapters); row++) {
                String hardwareId = text(adapters.getValue(Adapter.PNPDEVICEID, row));
                // The PhysicalAdapter flag alone may also be set by virtual NIC drivers.
                if (hardwareId == null || !hardwareId.matches("(?i)(PCI|USB|SD|PCMCIA)\\\\.*")) {
                    if (hardwareId == null || !hardwareId.matches("(?i)(ROOT|SWD)\\\\.*")) {
                        snapshot.warnings.add("Тип одного из активных сетевых адаптеров не определён");
                        snapshot.unclassifiedNetworkAdapter = true;
                        dhcpFlags.add(null);
                    }
                    continue;
                }
                Object flag = dhcpByIndex.get(adapters.getValue(Adapter.INDEX, row));
                Boolean dhcp = flag instanceof Boolean ? (Boolean) flag : null;
                dhcpFlags.add(dhcp);
                Set<String> addresses = Boolean.FALSE.equals(dhcp)
                        ? readStaticIpv4(positive(adapters.getValue(Adapter.INTERFACEINDEX, row)))
                        : Collections.emptySet();
                if (Boolean.FALSE.equals(dhcp) && addresses.isEmpty()) {
                    snapshot.warnings.add("Статический IPv4 одного из адаптеров недоступен");
                }
                String mode = dhcp == null ? "UNKNOWN" : dhcp ? "DHCP" : "STATIC";
                snapshot.networks.add(new HardwareSnapshot.Network(text(adapters.getValue(Adapter.NETCONNECTIONID, row)),
                        mode, addresses));
                snapshot.staticIpv4.addAll(addresses);
            }
            snapshot.networkMode = HardwareNormalization.networkMode(dhcpFlags);
            if ("UNKNOWN".equals(snapshot.networkMode)) {
                snapshot.warnings.add("Режим IPv4 не определён");
            }
        }

        private Set<String> readStaticIpv4(long interfaceIndex) {
            if (interfaceIndex <= 0 || interfaceIndex > Integer.MAX_VALUE) {
                return Collections.emptySet();
            }
            try {
                NetworkInterface adapter = NetworkInterface.getByIndex((int) interfaceIndex);
                if (adapter == null) {
                    return Collections.emptySet();
                }
                Set<String> result = new LinkedHashSet<>();
                Enumeration<InetAddress> addresses = adapter.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (HardwareNormalization.staticIpv4(address)) {
                        result.add(address.getHostAddress());
                    }
                }
                return result;
            } catch (SocketException | SecurityException exception) {
                return Collections.emptySet();
            }
        }

        private <T extends Enum<T>> WmiResult<T> query(String table, Class<T> properties) {
            return query(null, table, properties);
        }

        private <T extends Enum<T>> WmiResult<T> query(String namespace, String table, Class<T> properties) {
            return attempt(table.split(" ", 2)[0] + "/" + properties.getSimpleName(),
                    () -> executeQuery(namespace, table, properties), null);
        }

        private static <T extends Enum<T>> WmiResult<T> executeQuery(String namespace, String table, Class<T> properties) {
            try {
                WmiQuery<T> query = namespace == null ? new WmiQuery<>(table, properties)
                        : new WmiQuery<>(namespace, table, properties);
                return query.execute(5000);
            } catch (java.util.concurrent.TimeoutException exception) {
                throw new IllegalStateException(exception);
            }
        }

        private <T> T attempt(String source, Supplier<T> operation, T fallback) {
            try {
                return operation.get();
            } catch (RuntimeException | LinkageError exception) {
                snapshot.warnings.add(source);
                return fallback;
            }
        }

        private static int count(WmiResult<?> rows) {
            return rows == null ? 0 : rows.getResultCount();
        }

        private static long positive(Object value) {
            if (value == null) {
                return 0;
            }
            try {
                return Math.max(0, Long.parseLong(value.toString()));
            } catch (NumberFormatException exception) {
                return 0;
            }
        }
        }

    }

package com.pcinventory.agent.collector;

import com.sun.jna.platform.win32.COM.WbemcliUtil.WmiQuery;
import com.sun.jna.platform.win32.COM.WbemcliUtil.WmiResult;
import oshi.SystemInfo;
import oshi.hardware.Baseboard;
import oshi.hardware.CentralProcessor;
import oshi.software.os.OperatingSystem;
import oshi.util.platform.windows.WmiQueryHandler;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

public final class WindowsHardwareProbe {
    private enum MemoryArray { USE, MEMORYDEVICES }
    private enum Memory { DEVICELOCATOR, BANKLABEL, CAPACITY, MANUFACTURER, SPEED }
    private enum Video { NAME }
    private enum DiskDrive { MODEL, SIZE, INTERFACETYPE, MEDIATYPE, PNPDEVICEID }
    private enum Adapter { INDEX, PNPDEVICEID }
    private enum NetworkConfig { INDEX, DHCPENABLED }

    public final RuntimeProbe runtime = RuntimeProbe.read();
    public final List<String> warnings = new ArrayList<>();
    public final List<String> gpus = new ArrayList<>();
    public final List<MemoryModule> modules = new ArrayList<>();
    public final List<Disk> disks = new ArrayList<>();
    public String hostname;
    public String os;
    public String cpu;
    public String motherboard;
    public String networkMode = "UNKNOWN";
    public long visibleMemory;
    public long installedMemory;
    public int slotsTotal;
    public int modulesWithSpeed;

    private WindowsHardwareProbe() {
    }

    public static WindowsHardwareProbe read() {
        WindowsHardwareProbe result = new WindowsHardwareProbe();
        if (!System.getProperty("os.name").startsWith("Windows")) {
            result.warnings.add("Windows");
            return result;
        }
        result.hostname = System.getenv("COMPUTERNAME");
        result.readOshi();
        result.readWmi();
        return result;
    }

    private void readOshi() {
        SystemInfo system = attempt("OSHI", SystemInfo::new, null);
        if (system == null) {
            return;
        }
        os = attempt("OSHI/OS", () -> {
            OperatingSystem platform = system.getOperatingSystem();
            return platform + " · " + platform.getBitness() + "-bit";
        }, null);
        cpu = attempt("OSHI/CPU", () -> {
            CentralProcessor processor = system.getHardware().getProcessor();
            return processor.getProcessorIdentifier().getName() + " · "
                    + processor.getPhysicalProcessorCount() + " ядер / "
                    + processor.getLogicalProcessorCount() + " потоков";
        }, null);
        motherboard = attempt("OSHI/плата", () -> {
            Baseboard board = system.getHardware().getComputerSystem().getBaseboard();
            return (board.getManufacturer() + " " + board.getModel()).trim();
        }, null);
        visibleMemory = attempt("OSHI/RAM", () -> system.getHardware().getMemory().getTotal(), 0L);
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

    private void readMemory() {
        WmiResult<MemoryArray> arrays = query("Win32_PhysicalMemoryArray", MemoryArray.class);
        for (int row = 0; row < count(arrays); row++) {
            if (positive(arrays.getValue(MemoryArray.USE, row)) == 3) {
                slotsTotal += (int) positive(arrays.getValue(MemoryArray.MEMORYDEVICES, row));
            }
        }

        WmiResult<Memory> memory = query("Win32_PhysicalMemory", Memory.class);
        List<SmbiosMemory> speeds = attempt("SMBIOS/RAM", SmbiosMemory::read, Collections.emptyList());
        boolean allCapacitiesKnown = count(memory) > 0;
        long total = 0;
        for (int row = 0; row < count(memory); row++) {
            long capacity = positive(memory.getValue(Memory.CAPACITY, row));
            allCapacitiesKnown &= capacity > 0;
            total += capacity;
            String locator = readText(memory.getValue(Memory.DEVICELOCATOR, row));
            String bank = readText(memory.getValue(Memory.BANKLABEL, row));
            if (positive(memory.getValue(Memory.SPEED, row)) > 0) {
                modulesWithSpeed++;
            }
            SmbiosMemory speed = SmbiosMemory.match(speeds, locator, bank, capacity);
            modules.add(new MemoryModule(locator == null ? bank : locator, capacity,
                    readText(memory.getValue(Memory.MANUFACTURER, row)),
                    speed == null ? 0 : speed.ratedMtps, speed == null ? 0 : speed.configuredMtps));
        }
        installedMemory = allCapacitiesKnown ? total : 0;
        if (slotsTotal < modules.size()) {
            slotsTotal = 0;
        }
    }

    private void readGraphics() {
        WmiResult<Video> controllers = query("Win32_VideoController", Video.class);
        for (int row = 0; row < count(controllers); row++) {
            String name = readText(controllers.getValue(Video.NAME, row));
            if (name != null) {
                gpus.add(name);
            }
        }
    }

    private void readDisks() {
        WmiResult<DiskDrive> drives = query("Win32_DiskDrive", DiskDrive.class);
        for (int row = 0; row < count(drives); row++) {
            String name = readText(drives.getValue(DiskDrive.MODEL, row));
            String connection = readText(drives.getValue(DiskDrive.INTERFACETYPE, row));
            String media = readText(drives.getValue(DiskDrive.MEDIATYPE, row));
            String hardwareId = readText(drives.getValue(DiskDrive.PNPDEVICEID, row));
            long capacity = positive(drives.getValue(DiskDrive.SIZE, row));
            if (name != null && !"USB".equalsIgnoreCase(connection)
                    && (hardwareId == null || !hardwareId.toUpperCase(Locale.ROOT).startsWith("USBSTOR\\"))
                    && (media == null || !media.toLowerCase(Locale.ROOT).contains("removable"))) {
                disks.add(new Disk(name, connection, capacity));
            }
        }
    }

    private void readNetwork() {
        WmiResult<Adapter> adapters = query(
                "Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE AND NetConnectionStatus = 2", Adapter.class);
        WmiResult<NetworkConfig> configurations = query(
                "Win32_NetworkAdapterConfiguration WHERE IPEnabled = TRUE", NetworkConfig.class);
        Map<Object, Object> dhcpByIndex = new HashMap<>();
        for (int row = 0; row < count(configurations); row++) {
            dhcpByIndex.put(configurations.getValue(NetworkConfig.INDEX, row),
                    configurations.getValue(NetworkConfig.DHCPENABLED, row));
        }
        List<String> modes = new ArrayList<>();
        for (int row = 0; row < count(adapters); row++) {
            String hardwareId = readText(adapters.getValue(Adapter.PNPDEVICEID, row));
            // The PhysicalAdapter flag alone may also be set by virtual NIC drivers.
            if (hardwareId == null || !hardwareId.matches("(?i)(PCI|USB|SD|PCMCIA)\\\\.*")) {
                continue;
            }
            Object dhcp = dhcpByIndex.get(adapters.getValue(Adapter.INDEX, row));
            if (dhcp instanceof Boolean) {
                modes.add(Boolean.TRUE.equals(dhcp) ? "DHCP" : "STATIC");
            } else {
                modes.add("UNKNOWN");
            }
        }
        if (modes.contains("DHCP") && modes.contains("STATIC")) {
            networkMode = "MIXED";
        } else if (!modes.isEmpty() && !modes.contains("UNKNOWN")) {
            networkMode = modes.get(0);
        }
    }

    private <T extends Enum<T>> WmiResult<T> query(String table, Class<T> properties) {
        return attempt(table.split(" ", 2)[0] + "/" + properties.getSimpleName(),
                () -> executeQuery(table, properties), null);
    }

    private static <T extends Enum<T>> WmiResult<T> executeQuery(String table, Class<T> properties) {
        try {
            return new WmiQuery<>(table, properties).execute(5000);
        } catch (java.util.concurrent.TimeoutException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private <T> T attempt(String source, Supplier<T> operation, T fallback) {
        try {
            return operation.get();
        } catch (RuntimeException | LinkageError exception) {
            warnings.add(source);
            return fallback;
        }
    }

    private static int count(WmiResult<?> rows) {
        return rows == null ? 0 : rows.getResultCount();
    }

    private static String readText(Object value) {
        String text = value == null ? "" : value.toString().trim();
        return text.isEmpty() ? null : text;
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

    public List<String> diagnosticLines() {
        List<String> lines = new ArrayList<>();
        Collections.addAll(lines, runtime.toString(), "OSHI OS: " + os,
                "CPU available: " + (cpu != null), "Baseboard available: " + (motherboard != null),
                "OSHI visible RAM bytes: " + visibleMemory, "WMI installed RAM bytes: " + installedMemory,
                "WMI memory places: " + slotsTotal, "WMI installed modules: " + modules.size(),
                "WMI modules with Speed: " + modulesWithSpeed,
                "WMI graphics controllers: " + gpus.size(), "WMI disk candidates: " + disks.size(),
                "WMI network mode: " + networkMode, "Unavailable sources: " + warnings);
        for (MemoryModule module : modules) {
            lines.add("SMBIOS module: configured=" + module.configuredMtps + ", rated="
                    + module.ratedMtps + " MT/s (0 = unavailable)");
        }
        return lines;
    }

    public static final class MemoryModule {
        public final String label;
        public final long capacity;
        public final String manufacturer;
        public final int ratedMtps;
        public final int configuredMtps;

        private MemoryModule(String label, long capacity, String manufacturer, int ratedMtps, int configuredMtps) {
            this.label = label;
            this.capacity = capacity;
            this.manufacturer = manufacturer;
            this.ratedMtps = ratedMtps;
            this.configuredMtps = configuredMtps;
        }
    }

    public static final class Disk {
        public final String name;
        public final String connection;
        public final long capacity;

        private Disk(String name, String connection, long capacity) {
            this.name = name;
            this.connection = connection;
            this.capacity = capacity;
        }
    }
}

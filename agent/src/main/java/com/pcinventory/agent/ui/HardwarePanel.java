package com.pcinventory.agent.ui;

import com.pcinventory.agent.collector.WindowsHardwareProbe;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.text.JTextComponent;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.util.Locale;

final class HardwarePanel extends JPanel {
    private static final String[] LABELS = {
            "Имя компьютера", "Операционная система", "Процессор", "Материнская плата",
            "Видеокарты", "Оперативная память", "Сетевая конфигурация"
    };
    private static final Color PANEL = new Color(244, 244, 244);
    private static final Color OCCUPIED = new Color(223, 237, 226);
    private static final Color OCCUPIED_BORDER = new Color(121, 168, 132);
    private static final Color LINE = new Color(197, 199, 201);
    private final JTextComponent[] values = new JTextComponent[LABELS.length];
    private final JTextArea graphics = new JTextArea(1, 26);
    private final JLabel runtime = new JLabel();
    private final JTextArea warnings = new JTextArea(1, 26);
    private final JPanel memory = new JPanel(new BorderLayout());
    private final JPanel storage = new JPanel(new BorderLayout());

    HardwarePanel() {
        super(new BorderLayout());
        JPanel details = new JPanel(new GridBagLayout());
        for (int index = 0; index < LABELS.length; index++) {
            JTextComponent field = index == 4 ? graphics : new JTextField(26);
            field.setEditable(false);
            field.setBackground(new Color(234, 234, 234));
            values[index] = field;
            InventoryWindow.addLabeledRow(details, index, LABELS[index], field);
        }
        graphics.setBorder(new JTextField().getBorder());
        graphics.setLineWrap(true);
        graphics.setWrapStyleWord(true);

        JPanel sections = new JPanel();
        sections.setBorder(BorderFactory.createEmptyBorder(2, 6, 6, 6));
        sections.setLayout(new BoxLayout(sections, BoxLayout.Y_AXIS));
        sections.add(details);
        runtime.setVisible(false);
        runtime.setAlignmentX(Component.CENTER_ALIGNMENT);
        sections.add(runtime);
        sections.add(Box.createVerticalStrut(5));
        sections.add(memory);
        sections.add(Box.createVerticalStrut(5));
        sections.add(storage);
        warnings.setEditable(false);
        warnings.setOpaque(false);
        warnings.setLineWrap(true);
        warnings.setWrapStyleWord(true);
        warnings.setVisible(false);
        sections.add(warnings);

        add(sections, BorderLayout.PAGE_START);
        setSection(memory, "Слоты оперативной памяти", "", new JLabel("Ожидание чтения"));
        setSection(storage, "Физические накопители", "", new JLabel("Ожидание чтения"));
    }

    void showProbe(WindowsHardwareProbe probe) {
        String os = probe.os == null ? probe.runtime.os + " — по данным JVM" : probe.os;
        String memorySummary = probe.installedMemory > 0
                ? gibibytes(probe.installedMemory) + " · установлено"
                : probe.visibleMemory > 0 ? gibibytes(probe.visibleMemory) + " · видимо ОС" : null;
        setValues(probe.hostname, os, probe.cpu, probe.motherboard,
                probe.gpus.isEmpty() ? null : String.join("\n", probe.gpus), memorySummary, probe.networkMode);
        graphics.setRows(Math.max(1, probe.gpus.size()));
        runtime.setText("Java " + probe.runtime.javaVersion + " · JVM " + probe.runtime.jvmArchitecture);
        runtime.setVisible(true);

        JComponent memoryBody = new JLabel("Сведения о модулях не получены");
        if (!probe.modules.isEmpty()) {
            JPanel cards = new JPanel(new GridLayout(0, Math.min(4, probe.modules.size()), 5, 5));
            for (WindowsHardwareProbe.MemoryModule module : probe.modules) {
                String speed = null;
                if (module.configuredMtps > 0) {
                    speed = module.configuredMtps + " MT/s · настроено";
                } else if (module.ratedMtps > 0) {
                    speed = module.ratedMtps + " MT/s · номинал";
                }
                cards.add(memoryCard(module.label == null ? "Без маркировки" : module.label,
                        true, module.capacity > 0 ? gibibytes(module.capacity) : "Занят",
                        speed, module.manufacturer));
            }
            memoryBody = cards;
        }
        String slotCount = probe.slotsTotal > 0 ? " · мест по данным WMI: " + probe.slotsTotal : "";
        setSection(memory, "Слоты оперативной памяти",
                "Модулей: " + probe.modules.size() + slotCount, memoryBody);

        JComponent storageBody = new JLabel("Внутренние накопители не определены");
        if (!probe.disks.isEmpty()) {
            JPanel disks = new JPanel(new GridLayout(0, 1, 0, 4));
            for (WindowsHardwareProbe.Disk disk : probe.disks) {
                String capacity = disk.capacity > 0
                        ? String.format(Locale.ROOT, "%.1f GB", disk.capacity / 1_000_000_000.0) : "—";
                disks.add(diskRow("—", disk.name, disk.connection, capacity));
            }
            storageBody = disks;
        }
        setSection(storage, "Физические накопители", "Найдено: " + probe.disks.size(), storageBody);
        warnings.setText("Недоступные источники: " + String.join(", ", probe.warnings));
        warnings.setVisible(!probe.warnings.isEmpty());
    }

    void showPreview() {
        setValues("OFFICE-PC-012", "Windows 10 Pro x64", "Intel Core i5-10400 (6 ядер / 12 потоков)",
                "ASUS PRIME B460M-A", "NVIDIA GeForce GTX 1650 — 4 GiB", "16 GiB DDR4",
                "Статический IP: 192.0.2.105");
        JPanel slots = new JPanel(new GridLayout(1, 4, 5, 0));
        slots.add(memoryCard("DIMM A1", false, "Свободен", null, null));
        slots.add(memoryCard("DIMM A2", true, "8 GiB DDR4", "2666 MT/s", "Kingston"));
        slots.add(memoryCard("DIMM B1", false, "Свободен", null, null));
        slots.add(memoryCard("DIMM B2", true, "8 GiB DDR4", null, "Kingston"));
        setSection(memory, "Слоты оперативной памяти", "Занято 2 из 4", slots);

        JPanel disks = new JPanel(new GridLayout(0, 1, 0, 4));
        disks.add(diskRow("SSD", "Samsung SSD 870 EVO", "SATA", "500 GB"));
        disks.add(diskRow("HDD", "Western Digital WD10EZEX", "SATA", "1 TB"));
        setSection(storage, "Физические накопители", "2 устройства", disks);
    }

    private void setValues(String... text) {
        for (int index = 0; index < values.length; index++) {
            values[index].setText(text[index] == null ? "—" : text[index]);
            values[index].setCaretPosition(0);
        }
    }

    private static String gibibytes(long bytes) {
        return String.format(Locale.ROOT, "%.1f GiB", bytes / 1_073_741_824.0);
    }

    private static void setSection(JPanel section, String name, String summary, JComponent body) {
        section.removeAll();
        section.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(LINE), BorderFactory.createEmptyBorder(4, 5, 5, 5)));
        JPanel header = new JPanel(new BorderLayout());
        header.add(new JLabel(name), BorderLayout.LINE_START);
        header.add(new JLabel(summary), BorderLayout.LINE_END);
        section.setLayout(new BorderLayout(0, 4));
        section.add(header, BorderLayout.PAGE_START);
        section.add(body, BorderLayout.CENTER);
        section.revalidate();
        section.repaint();
    }

    private static JPanel memoryCard(String label, boolean occupied, String capacity, String speed,
                                     String manufacturer) {
        JPanel card = new JPanel();
        card.setLayout(new BoxLayout(card, BoxLayout.Y_AXIS));
        decorate(card, occupied ? OCCUPIED : PANEL, occupied ? OCCUPIED_BORDER : LINE);
        addCentered(card, hardwareLabel(label));
        JComponent module = new JComponent() {
            @Override
            protected void paintComponent(Graphics graphics) {
                int width = getWidth();
                graphics.setColor(occupied ? new Color(52, 113, 73) : new Color(202, 203, 204));
                graphics.fillRoundRect(0, 3, width, 16, 5, 5);
                if (occupied) {
                    graphics.setColor(new Color(31, 65, 44));
                    for (int chip = 0; chip < 6; chip++) {
                        graphics.fillRoundRect(4 + chip * ((width - 8) / 6), 7, (width - 8) / 6 - 2, 8, 2, 2);
                    }
                    graphics.setColor(new Color(179, 138, 67));
                    graphics.fillRect(7, 19, width - 14, 2);
                } else {
                    graphics.setColor(new Color(142, 144, 146));
                    graphics.fillRect(8, 10, width - 16, 2);
                }
            }
        };
        Dimension moduleSize = new Dimension(72, 23);
        module.setPreferredSize(moduleSize);
        module.setMaximumSize(moduleSize);
        addCentered(card, module);
        addCentered(card, new JLabel(capacity));
        if (speed != null) {
            addCentered(card, new JLabel(speed));
        }
        if (manufacturer != null) {
            addCentered(card, hardwareLabel(manufacturer));
        }
        return card;
    }

    private static void addCentered(JPanel panel, JComponent component) {
        component.setAlignmentX(Component.CENTER_ALIGNMENT);
        panel.add(component);
    }

    private static JPanel diskRow(String type, String model, String connection, String capacity) {
        JPanel row = new JPanel(new BorderLayout(8, 0));
        decorate(row, PANEL, LINE);
        JLabel badge = new JLabel(type, JLabel.CENTER);
        badge.setOpaque(true);
        badge.setBackground(new Color(68, 84, 96));
        badge.setForeground(Color.WHITE);
        badge.setPreferredSize(new Dimension(36, 29));
        JPanel description = new JPanel(new GridLayout(0, 1));
        description.setOpaque(false);
        description.add(hardwareLabel(model));
        if (connection != null) {
            description.add(hardwareLabel("—".equals(type) ? connection : type + " · " + connection));
        }
        row.add(badge, BorderLayout.LINE_START);
        row.add(description, BorderLayout.CENTER);
        row.add(new JLabel(capacity), BorderLayout.LINE_END);
        return row;
    }

    private static void decorate(JPanel card, Color background, Color border) {
        card.setBackground(background);
        card.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(border), BorderFactory.createEmptyBorder(3, 5, 3, 5)));
    }

    private static JLabel hardwareLabel(String text) {
        JLabel label = new JLabel();
        label.putClientProperty("html.disable", Boolean.TRUE);
        label.setText(text);
        return label;
    }
}

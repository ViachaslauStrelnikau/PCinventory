package com.pcinventory.agent.ui;

import com.pcinventory.agent.collector.RuntimeProbe;

import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.GridBagLayout;
import java.awt.GridLayout;

final class HardwarePanel extends JPanel {
    private static final String[] LABELS = {
            "Имя компьютера", "Операционная система", "Процессор", "Материнская плата",
            "Видеокарты", "Оперативная память", "Сетевая конфигурация"
    };
    private static final Color PANEL = new Color(244, 244, 244);
    private static final Color OCCUPIED = new Color(223, 237, 226);
    private static final Color OCCUPIED_BORDER = new Color(121, 168, 132);
    private static final Color LINE = new Color(197, 199, 201);
    private final JTextField[] values = new JTextField[LABELS.length];
    private final JLabel runtime = new JLabel();
    private final JPanel memory = new JPanel(new BorderLayout());
    private final JPanel storage = new JPanel(new BorderLayout());

    HardwarePanel() {
        super(new BorderLayout());
        JPanel details = new JPanel(new GridBagLayout());
        for (int index = 0; index < LABELS.length; index++) {
            JTextField field = new JTextField(26);
            field.setEditable(false);
            field.setBackground(new Color(234, 234, 234));
            values[index] = field;
            InventoryWindow.addLabeledRow(details, index, LABELS[index], field);
        }

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

        add(sections, BorderLayout.PAGE_START);
        setSection(memory, "Слоты оперативной памяти", "", new JLabel("Ожидание чтения"));
        setSection(storage, "Физические накопители", "", new JLabel("Ожидание чтения"));
    }

    void showRuntime(RuntimeProbe probe) {
        values[1].setText(probe.os + " — по данным JVM");
        values[1].setCaretPosition(0);
        runtime.setText("Java " + probe.javaVersion + " · JVM " + probe.jvmArchitecture);
        runtime.setVisible(true);
        setSection(memory, "Слоты оперативной памяти", "", new JLabel("Сведения недоступны в каркасе"));
        setSection(storage, "Физические накопители", "", new JLabel("Сведения недоступны в каркасе"));
    }

    void showPreview() {
        String[] sample = {
                "OFFICE-PC-012", "Windows 10 Pro x64", "Intel Core i5-10400 (6 ядер / 12 потоков)",
                "ASUS PRIME B460M-A", "NVIDIA GeForce GTX 1650 — 4 GiB", "16 GiB DDR4",
                "Статический IP: 192.0.2.105"
        };
        for (int index = 0; index < values.length; index++) {
            values[index].setText(sample[index]);
            values[index].setCaretPosition(0);
        }
        JPanel slots = new JPanel(new GridLayout(1, 4, 5, 0));
        slots.add(memoryCard("DIMM A1", false, null));
        slots.add(memoryCard("DIMM A2", true, "2666 MT/s"));
        slots.add(memoryCard("DIMM B1", false, null));
        slots.add(memoryCard("DIMM B2", true, null));
        setSection(memory, "Слоты оперативной памяти", "Занято 2 из 4", slots);

        JPanel disks = new JPanel(new GridLayout(0, 1, 0, 4));
        disks.add(diskRow("SSD", "Samsung SSD 870 EVO", "SATA", "500 GB"));
        disks.add(diskRow("HDD", "Western Digital WD10EZEX", "SATA", "1 TB"));
        setSection(storage, "Физические накопители", "2 устройства", disks);
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

    private static JPanel memoryCard(String label, boolean occupied, String speed) {
        JPanel card = new JPanel();
        card.setLayout(new BoxLayout(card, BoxLayout.Y_AXIS));
        decorate(card, occupied ? OCCUPIED : PANEL, occupied ? OCCUPIED_BORDER : LINE);
        addCentered(card, new JLabel(label));
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
        addCentered(card, new JLabel(occupied ? "8 GiB DDR4" : "Свободен"));
        if (speed != null) {
            addCentered(card, new JLabel(speed));
        }
        if (occupied) {
            addCentered(card, new JLabel("Kingston"));
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
        description.add(new JLabel(model));
        description.add(new JLabel(type + " · " + connection));
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
}
